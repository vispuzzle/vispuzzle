#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate MLLM baseline scores for all comparison tasks."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, Iterable, List, Optional

CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parent

if __package__:
    from .baseline_judge import DEFAULT_EXTENSIONS, build_output_filename, run as run_baseline
else:
    sys.path.append(str(REPO_ROOT))
    from search.scoring_model.baseline_judge import DEFAULT_EXTENSIONS, build_output_filename, run as run_baseline


def load_comparison_tasks(comparisons_dir: Path) -> Dict[str, Dict[str, List[Path]]]:
    tasks: Dict[str, Dict[str, List[Path]]] = {}
    for path in sorted(comparisons_dir.glob("comparison_*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"Warning: Could not parse {path}")
            continue
        task_id = data.get("task_id")
        dataset = data.get("dataset")
        if not task_id:
            continue
        entry = tasks.setdefault(task_id, {"datasets": [], "files": []})
        if dataset and dataset not in entry["datasets"]:
            entry["datasets"].append(dataset)
        entry["files"].append(path)
    return tasks


def deduce_dataset(task_dir: Path, declared: Optional[str]) -> Optional[str]:
    if declared:
        return declared
    metadata_path = task_dir / "task_metadata.json"
    if metadata_path.is_file():
        try:
            metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            dataset_name = metadata.get("dataset_name")
            if dataset_name:
                return dataset_name
        except json.JSONDecodeError:
            print(f"Warning: Could not parse metadata {metadata_path}")
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate MLLM baselines for all tasks with comparison logs.")
    parser.add_argument(
        "--comparisons-dir",
        type=Path,
        default=REPO_ROOT / "user_study_data" / "comparisons",
        help="Directory containing comparison_*.json logs.",
    )
    parser.add_argument(
        "--task-outputs-dir",
        type=Path,
        default=REPO_ROOT / "task_outputs",
        help="Directory containing task_* output folders.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        help="Optional directory to store baseline JSON files. Defaults to each task directory.",
    )
    parser.add_argument(
        "--summary-output",
        type=Path,
        help="Optional path to write an aggregated summary JSON.",
    )
    parser.add_argument("--model-overall", default="gemini-3-pro-preview", help="Model name for overall baseline prompt.")
    parser.add_argument(
        "--model-dimensions",
        default="gemini-3-pro-preview",
        help="Model name for three-dimension baseline prompt.",
    )
    parser.add_argument(
        "--extensions",
        default=",".join(sorted(DEFAULT_EXTENSIONS)),
        help="Comma-separated list of image extensions to include.",
    )
    parser.add_argument("--limit", type=int, help="Optional maximum number of images per task.")
    parser.add_argument("--concurrency", type=int, default=20, help="Parallel requests per task (default: 20).")
    parser.add_argument(
        "--repeats",
        type=int,
        default=3,
        help="How many times to run each baseline prompt per image (default: 3).",
    )
    return parser.parse_args()


def determine_output_path(
    task_dir: Path,
    task_id: str,
    base_output_dir: Optional[Path],
    model_overall: Optional[str],
    model_dimensions: Optional[str],
) -> Path:
    filename = build_output_filename(model_overall, model_dimensions)
    if base_output_dir:
        base_output_dir.mkdir(parents=True, exist_ok=True)
        return base_output_dir / f"{task_id}_{filename}"
    return task_dir / filename


def load_needed_tasks(needed_path: Path) -> Dict[str, set]:
    """Load needed tasks and their required images."""
    if not needed_path.exists():
        return {}
    try:
        data = json.loads(needed_path.read_text(encoding="utf-8"))
        needed = {}
        for task_id, pairs in data.items():
            images = set()
            for pair in pairs:
                for img in pair:
                    # img is like "data/cars/cars_0_15.svg"
                    images.add(img)
            needed[task_id] = images
        return needed
    except Exception as e:
        print(f"Error loading needed.json: {e}")
        return {}


def main() -> None:
    args = parse_args()
    comparisons_dir = args.comparisons_dir
    task_outputs_dir = args.task_outputs_dir

    if not comparisons_dir.is_dir():
        raise FileNotFoundError(f"Comparisons directory not found: {comparisons_dir}")
    if not task_outputs_dir.is_dir():
        raise FileNotFoundError(f"Task outputs directory not found: {task_outputs_dir}")

    tasks = load_comparison_tasks(comparisons_dir)
    if not tasks:
        raise RuntimeError("No comparison tasks found.")

    # Load needed.json whitelist
    needed_tasks = load_needed_tasks(task_outputs_dir / "needed.json")
    if needed_tasks:
        print(f"Loaded whitelist with {len(needed_tasks)} tasks.")
    else:
        print("Processing all tasks (no whitelist found or empty).")

    extensions: Iterable[str] = [
        ext if ext.startswith(".") else f".{ext}" for ext in args.extensions.split(",") if ext
    ]

    summary_rows = []
    total_session_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    for task_id, info in sorted(tasks.items()):
        # Filter by needed.json if it exists
        whitelist = None
        if needed_tasks:
            if task_id not in needed_tasks:
                continue
            whitelist = needed_tasks[task_id]
            print(f"Task {task_id} whitelisted {len(whitelist)} images.")

        task_dir = task_outputs_dir / task_id
        if not task_dir.is_dir():
            print(f"Warning: Missing task directory for {task_id}")
            continue
        dataset = deduce_dataset(task_dir, info["datasets"][0] if info["datasets"] else None)
        output_path = determine_output_path(
            task_dir,
            task_id,
            args.output_dir,
            args.model_overall,
            args.model_dimensions,
        )
        # Removed skip-if-exists check to allow resuming/updating runs
        
        print(f"\n=== Processing {task_id} (dataset: {dataset or 'all'}) ===")
        payload = run_baseline(
            task_dir=task_dir,
            dataset=dataset,
            output_path=output_path,
            model_overall=args.model_overall,
            model_dimensions=args.model_dimensions,
            extensions=extensions,
            limit=args.limit,
            concurrency=args.concurrency,
            repeats=max(1, args.repeats),
            whitelist=whitelist,
        )
        
        usage = payload.get("session_usage", {})
        total_session_usage["prompt_tokens"] += usage.get("prompt_tokens", 0)
        total_session_usage["completion_tokens"] += usage.get("completion_tokens", 0)
        total_session_usage["total_tokens"] += usage.get("total_tokens", 0)
        
        summary_rows.append(
            {
                "task_id": task_id,
                "dataset": dataset,
                "output": str(output_path),
                "image_count": payload.get("image_count"),
                "summary": payload.get("summary"),
                "session_usage": usage,
            }
        )

    print("\n=== Total Session Token Usage ===")
    print(f"Prompt Tokens: {total_session_usage['prompt_tokens']}")
    print(f"Completion Tokens: {total_session_usage['completion_tokens']}")
    print(f"Total Tokens: {total_session_usage['total_tokens']}")

    if args.summary_output and summary_rows:
        args.summary_output.parent.mkdir(parents=True, exist_ok=True)
        args.summary_output.write_text(json.dumps(summary_rows, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\nAggregated summary written to {args.summary_output}")


if __name__ == "__main__":
    main()
