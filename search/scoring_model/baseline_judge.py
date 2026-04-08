#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compute MLLM baseline scores for composite visualizations in task outputs."""

from __future__ import annotations

import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from statistics import mean, fmean
from typing import Any, Dict, Iterable, List, Optional, Tuple

if __package__:
    from .scoring_model import ask_image, image_to_base64
    from search.task_analyzer import TaskParser
else:  # Allows running as a script from repo root.
    import sys

    sys.path.append(str(Path(__file__).resolve().parent.parent))
    from search.scoring_model.scoring_model import ask_image, image_to_base64
    from search.task_analyzer import TaskParser

PROMPT_PATH = Path(__file__).with_name("baseline_prompts.json")
DEFAULT_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg"}
DIMENSION_KEYS = ("Expressiveness", "Effectiveness", "Aesthetics")


def _clean_column_name(raw: str) -> str:
    text = str(raw).strip().lower()
    if text.startswith("cnt(") and text.endswith(")"):
        inner = text[4:-1].strip()
        return f"count of {inner}"
    text = text.replace("_", " ")
    return text


def _load_task_descriptions(task_dir: Path) -> Tuple[List[str], Optional[str]]:
    metadata_path = task_dir / "task_metadata.json"
    if not metadata_path.exists():
        return [], None

    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return [], None

    analysis_tasks = metadata.get("parameters", {}).get("analysis_tasks")
    if not isinstance(analysis_tasks, list) or not analysis_tasks:
        return [], None

    descriptions: List[str] = []
    parser = TaskParser()

    relation_raw = metadata.get("parameters", {}).get("task_relation")
    relation = relation_raw.lower() if isinstance(relation_raw, str) else None
    if relation not in {"and", "or"}:
        relation = None

    for task in analysis_tasks:
        if not isinstance(task, (list, tuple)) or not task:
            continue
        insight = str(task[0]).lower()
        columns: List[str] = []
        if len(task) > 1 and isinstance(task[1], (list, tuple)):
            columns = [_clean_column_name(col) for col in task[1]]

        try:
            description = parser.get_description(insight, columns)
        except Exception:
            description = ""

        if description:
            normalized = description.strip()
            if normalized and normalized not in descriptions:
                descriptions.append(normalized)

    return descriptions, relation


def _append_task_context(base_prompt: str, task_descriptions: List[str], relation: Optional[str]) -> str:
    if not task_descriptions:
        return base_prompt

    bullet_list = "\n".join(f"- {desc}" for desc in task_descriptions)
    if relation == "and":
        requirement = "All of these goals must be satisfied together."
    elif relation == "or":
        requirement = "Satisfying any one of these goals is sufficient."
    else:
        requirement = "Use these goals as context for your assessment."
    context = (
        "\n\n### ANALYSIS TASKS ###\n"
        "These visualizations target the following analytical goals:\n"
        f"{bullet_list}\n"
        f"Requirement: {requirement}\n"
    )
    return base_prompt.rstrip() + context


def _sanitize_label(label: Optional[str]) -> str:
    if not label:
        return "skip"
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", label)
    cleaned = cleaned.strip("-_")
    return cleaned or "model"


def build_output_filename(model_overall: Optional[str], model_dimensions: Optional[str]) -> str:
    overall_label = _sanitize_label(model_overall)
    dim_label = _sanitize_label(model_dimensions)
    return f"baseline_scores__overall-{overall_label}__dimensions-{dim_label}.json"


def load_prompts() -> Dict[str, str]:
    with PROMPT_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def parse_overall_response(response: str) -> Dict[str, Any]:
    # Updated to handle Markdown bolding like **Score: 5** or **Score: 4.5**
    score_match = re.search(r"Score\s*:?\s*(?:\*\*|__)?\s*([1-5](?:\.\d+)?)", response, re.IGNORECASE)
    explain_match = re.search(r"Explain\s*:?\s*(?:\*\*|__)?\s*(.*)", response, re.IGNORECASE | re.DOTALL)
    score = float(score_match.group(1)) if score_match else None
    explanation = explain_match.group(1).strip() if explain_match else response.strip()
    return {"score": score, "explain": explanation, "raw": response}


def parse_dimension_response(response: str) -> Dict[str, Dict[str, Any]]:
    # Updated regex to handle Markdown headers (###), bolding (**Score:**) and decimals
    pattern = re.compile(
        r"(?:^|\n|#+\s*)(?:\*\*|__)?(?P<dim>Expressiveness|Effectiveness|Aesthetics)(?:\*\*|__)?(?:[^\n]*)\s*"
        r"(?:\*\*|__)?(?:Score|Rating)\s*:?\s*(?:\*\*|__)?\s*(?P<score>[1-5](?:\.\d+)?)\s*(?:\*\*|__)?\s*"
        r"(?:\*\*|__)?(?:Explain|Explanation|Justification)\s*:?\s*(?:\*\*|__)?\s*(?P<explain>.*?)"
        r"(?=(?:^|\n|#+\s*)(?:\*\*|__)?(?:Expressiveness|Effectiveness|Aesthetics)|$)",
        re.IGNORECASE | re.DOTALL,
    )
    parsed: Dict[str, Dict[str, Any]] = {}
    for match in pattern.finditer(response):
        key = match.group("dim").capitalize()
        score = float(match.group("score"))
        explanation = match.group("explain").strip()
        parsed[key] = {"score": score, "explain": explanation}
    for key in DIMENSION_KEYS:
        if key not in parsed:
            parsed[key] = {"score": None, "explain": "Could not parse response.", "raw": response}
        else:
            parsed[key]["raw"] = response
    return parsed


def collect_images(task_dir: Path, dataset: Optional[str], extensions: Iterable[str], whitelist: Optional[Iterable[str]] = None) -> List[Path]:
    data_root = task_dir / "data"
    if not data_root.is_dir():
        raise FileNotFoundError(f"Missing data directory: {data_root}")
    exts = {ext.lower() for ext in extensions}
    if dataset:
        candidates = [data_root / dataset]
    else:
        candidates = [p for p in data_root.iterdir() if p.is_dir()]
    image_paths: List[Path] = []
    
    # Normalize whitelist for comparison (resolve paths or just filenames?)
    # The whitelist from needed.json seems to be relative paths like "data/cars/cars_0_15.svg"
    # We should check if the absolute path ends with the whitelist item, or match exactly relative to task_dir?
    # The whitelist items are like "data/cars/cars_0_15.svg".
    # The task_dir is ".../task_outputs/task_1762345188".
    # The images are in ".../task_outputs/task_1762345188/data/cars/cars_0_15.svg".
    # So if we resolve the whitelist item relative to task_dir, we get the absolute path.
    
    allowed_paths = None
    if whitelist:
        allowed_paths = set()
        for w in whitelist:
            # Handle both absolute and relative paths
            # If w is relative, assume it's relative to task_dir
            p = Path(w)
            if not p.is_absolute():
                p = task_dir / p
            allowed_paths.add(p.resolve())

    for root in candidates:
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.suffix.lower() in exts and path.is_file():
                if allowed_paths is not None:
                    if path.resolve() not in allowed_paths:
                        continue
                image_paths.append(path)
    if not image_paths:
        # If whitelist was provided but no images found, it might be a path issue or empty task.
        # We shouldn't raise RuntimeError if it's just that the whitelist didn't match anything (maybe task has no relevant images?)
        # But for now, let's keep it but maybe warn.
        if whitelist:
            print(f"Warning: No images found matching whitelist in {task_dir}")
            return []
        raise RuntimeError("No images found with the specified filters.")
    return image_paths


def aggregate_scores(images: List[Dict[str, Any]]) -> Dict[str, Any]:
    overall_scores = [entry["overall"]["score"] for entry in images if entry["overall"]["score"] is not None]
    dim_scores: Dict[str, List[int]] = {key: [] for key in DIMENSION_KEYS}
    for entry in images:
        dims = entry["dimensions"]
        for key in DIMENSION_KEYS:
            score = dims[key]["score"]
            if score is not None:
                dim_scores[key].append(score)

    summary: Dict[str, Any] = {
        "overall": {
            "mean": mean(overall_scores) if overall_scores else None,
            "count": len(overall_scores),
        },
        "dimensions": {
            key: {
                "mean": mean(scores) if scores else None,
                "count": len(scores),
            }
            for key, scores in dim_scores.items()
        },
    }
    return summary


def _average_numbers(values: List[Optional[float]]) -> Optional[float]:
    numeric = [float(value) for value in values if isinstance(value, (int, float))]
    return fmean(numeric) if numeric else None


def _merge_overall_runs(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not runs:
        return {"score": None, "explain": "Unavailable", "raw": ""}
    result = dict(runs[-1])
    scores = [run.get("score") for run in runs]
    result["score_runs"] = scores
    result["score"] = _average_numbers(scores)
    result["raw_runs"] = [run.get("raw") for run in runs]
    result["explain_runs"] = [run.get("explain") for run in runs]
    return result


def _merge_dimension_runs(runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not runs:
        return {key: {"score": None, "explain": "Unavailable", "raw": ""} for key in DIMENSION_KEYS}
    merged: Dict[str, Any] = {}
    for key in DIMENSION_KEYS:
        key_scores = [run[key]["score"] for run in runs if run[key]["score"] is not None]
        merged[key] = dict(runs[-1][key])
        merged[key]["score_runs"] = [run[key]["score"] for run in runs]
        merged[key]["score"] = _average_numbers(key_scores)
        merged[key]["raw_runs"] = [run[key].get("raw") for run in runs]
        merged[key]["explain_runs"] = [run[key].get("explain") for run in runs]
    merged["prompt"] = runs[-1].get("prompt")
    return merged


def evaluate_image(
    image_path: Path,
    prompts: Dict[str, str],
    model_overall: str,
    model_dimensions: str,
    task_descriptions: List[str],
    task_relation: Optional[str],
    repeats: int,
) -> Dict[str, Any]:
    encoded = image_to_base64(str(image_path))
    repeat_runs = max(1, repeats)
    prompt_overall = _append_task_context(prompts["overall"], task_descriptions, task_relation)
    prompt_dimensions = _append_task_context(prompts["dimensions"], task_descriptions, task_relation)

    overall_runs: List[Dict[str, Any]] = []
    dimension_runs: List[Dict[str, Any]] = []
    
    total_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    for _ in range(repeat_runs):
        overall_response, usage1 = ask_image(prompt_overall, encoded, model_overall, return_usage=True)
        if usage1:
            total_usage["prompt_tokens"] += getattr(usage1, "prompt_tokens", 0)
            total_usage["completion_tokens"] += getattr(usage1, "completion_tokens", 0)
            total_usage["total_tokens"] += getattr(usage1, "total_tokens", 0)

        overall_result = parse_overall_response(overall_response)
        overall_result["prompt"] = prompt_overall
        overall_runs.append(overall_result)

        dimension_response, usage2 = ask_image(prompt_dimensions, encoded, model_dimensions, return_usage=True)
        if usage2:
            total_usage["prompt_tokens"] += getattr(usage2, "prompt_tokens", 0)
            total_usage["completion_tokens"] += getattr(usage2, "completion_tokens", 0)
            total_usage["total_tokens"] += getattr(usage2, "total_tokens", 0)

        dimension_result = parse_dimension_response(dimension_response)
        dimension_result["prompt"] = prompt_dimensions
        dimension_runs.append(dimension_result)

    aggregated_overall = _merge_overall_runs(overall_runs)
    aggregated_dimensions = _merge_dimension_runs(dimension_runs)
    return {
        "path": str(image_path), 
        "overall": aggregated_overall, 
        "dimensions": aggregated_dimensions,
        "usage": total_usage
    }


def run(
    task_dir: Path,
    dataset: Optional[str],
    output_path: Path,
    model_overall: str,
    model_dimensions: str,
    extensions: Iterable[str],
    limit: Optional[int],
    concurrency: int,
    repeats: int = 1,
    whitelist: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    prompts = load_prompts()
    task_descriptions, task_relation = _load_task_descriptions(task_dir)
    images = collect_images(task_dir, dataset, extensions, whitelist=whitelist)
    if limit is not None:
        images = images[:limit]

    # Load existing results
    existing_results = {}
    if output_path.exists():
        try:
            data = json.loads(output_path.read_text(encoding="utf-8"))
            for img_entry in data.get("images", []):
                existing_results[img_entry["path"]] = img_entry
        except Exception as e:
            print(f"Error loading existing results: {e}")

    results: List[Optional[Dict[str, Any]]] = [None] * len(images)
    concurrency = max(1, concurrency)
    
    session_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    
    futures = {}
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        for idx, image in enumerate(images):
            img_path_str = str(image.resolve())
            # Try to match existing by resolved path
            existing = existing_results.get(img_path_str)
            # Fallback: try matching by just filename if path changed (unlikely but possible)
            if not existing:
                for p, res in existing_results.items():
                    if Path(p).name == image.name:
                        existing = res
                        break

            current_runs = 0
            if existing:
                if "score_runs" in existing["overall"]:
                    current_runs = len(existing["overall"]["score_runs"])
                elif existing["overall"].get("score") is not None:
                    current_runs = 1
            
            needed = max(0, repeats - current_runs)
            
            if needed == 0 and existing:
                results[idx] = existing
                print(f"[{idx+1}/{len(images)}] Skipped {image.name} (already has {current_runs} runs)")
                continue
            
            print(f"[{idx+1}/{len(images)}] Scheduling {image.name} for {needed} runs (has {current_runs})")
            future = executor.submit(
                evaluate_image,
                image,
                prompts,
                model_overall,
                model_dimensions,
                task_descriptions,
                task_relation,
                needed,
            )
            futures[future] = (idx, existing)

        for completed_idx, future in enumerate(as_completed(futures), start=1):
            idx, existing = futures[future]
            image = images[idx]
            try:
                new_result = future.result()
                
                # Aggregate usage
                if "usage" in new_result:
                    u = new_result["usage"]
                    session_usage["prompt_tokens"] += u.get("prompt_tokens", 0)
                    session_usage["completion_tokens"] += u.get("completion_tokens", 0)
                    session_usage["total_tokens"] += u.get("total_tokens", 0)

                if existing:
                    # Helper to extract runs from a result dict section
                    def get_runs(section):
                        if "score_runs" in section:
                            return [
                                {"score": s, "explain": e, "raw": r}
                                for s, e, r in zip(section["score_runs"], section["explain_runs"], section["raw_runs"])
                            ]
                        elif section.get("score") is not None:
                            return [{"score": section["score"], "explain": section.get("explain"), "raw": section.get("raw")}]
                        return []

                    # Merge Overall
                    old_runs = get_runs(existing["overall"])
                    new_runs = get_runs(new_result["overall"])
                    combined_overall = _merge_overall_runs(old_runs + new_runs)
                    
                    # Merge Dimensions
                    combined_dims = {}
                    for key in DIMENSION_KEYS:
                        old_d = existing["dimensions"].get(key, {})
                        new_d = new_result["dimensions"].get(key, {})
                        r1 = get_runs(old_d)
                        r2 = get_runs(new_d)
                        combined_dims[key] = _merge_overall_runs(r1 + r2)
                    
                    results[idx] = {
                        "path": new_result["path"],
                        "overall": combined_overall,
                        "dimensions": combined_dims
                    }
                else:
                    results[idx] = new_result
                print(f"[{completed_idx}/{len(futures)}] Completed {image.name}")
            except Exception as exc:
                print(f"Failed to score {image}: {exc}")
                if existing:
                    results[idx] = existing

    results = [entry for entry in results if entry is not None]
    summary = aggregate_scores(results) if results else {}
    payload = {
        "task_dir": str(task_dir),
        "dataset": dataset,
        "model_overall": model_overall,
        "model_dimensions": model_dimensions,
        "extensions": list(extensions),
        "image_count": len(results),
        "analysis_tasks": task_descriptions,
        "task_relation": task_relation,
        "summary": summary,
        "session_usage": session_usage,
        "images": results,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate MLLM baseline scores for task outputs.")
    parser.add_argument("--task-dir", type=Path, required=True, help="Path to the task_*/ directory containing data/.")
    parser.add_argument("--dataset", help="Optional dataset subdirectory under data/ to evaluate.")
    parser.add_argument("--output", type=Path, help="Optional output JSON path (default: baseline_scores.json in task dir).")
    parser.add_argument("--model-overall", default="gemini-2.5-flash", help="Model name for overall scoring prompt.")
    parser.add_argument("--model-dimensions", default="gemini-2.5-flash", help="Model name for dimension scoring prompt.")
    parser.add_argument("--extensions", default=",".join(sorted(DEFAULT_EXTENSIONS)), help="Comma-separated list of image extensions to include.")
    parser.add_argument("--limit", type=int, help="Optional maximum number of images to score.")
    parser.add_argument("--concurrency", type=int, default=5, help="Number of images to evaluate in parallel (default: 5).")
    parser.add_argument("--repeats", type=int, default=1, help="How many times to query each baseline prompt per image (default: 1).")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    extensions = [ext if ext.startswith(".") else f".{ext}" for ext in args.extensions.split(",") if ext]
    default_filename = build_output_filename(
        args.model_overall if not args.skip_overall else None,
        args.model_dimensions if not args.skip_dimensions else None,
    )
    output_path = args.output or (args.task_dir / default_filename)
    payload = run(
        task_dir=args.task_dir,
        dataset=args.dataset,
        output_path=output_path,
        model_overall=args.model_overall,
        model_dimensions=args.model_dimensions,
        extensions=extensions,
        limit=args.limit,
        concurrency=args.concurrency,
        repeats=max(1, args.repeats),
    )
    print(f"Saved baseline scores to {output_path}")
    if payload.get("summary"):
        print("Summary:")
        overall = payload["summary"].get("overall", {})
        print(
            f"  Overall baseline -> mean: {overall.get('mean')}, count: {overall.get('count')}"
        )
        dims = payload["summary"].get("dimensions", {})
        for key in DIMENSION_KEYS:
            dim_summary = dims.get(key, {})
            print(
                f"  {key} baseline -> mean: {dim_summary.get('mean')}, count: {dim_summary.get('count')}"
            )


if __name__ == "__main__":
    main()
