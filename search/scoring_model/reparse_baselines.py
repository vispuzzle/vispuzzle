#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Reparse existing baseline score JSONs using updated regex logic."""

import json
import sys
import shutil
from pathlib import Path
from typing import Any, Dict, List

# Ensure we can import from the same directory
CURRENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = CURRENT_DIR.parent
sys.path.append(str(REPO_ROOT))

from search.scoring_model.baseline_judge import (
    parse_overall_response,
    parse_dimension_response,
    _merge_overall_runs,
    _merge_dimension_runs,
    aggregate_scores,
    DIMENSION_KEYS,
)

def reparse_file(file_path: Path) -> None:
    print(f"Processing {file_path}...")
    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"  Error reading JSON: {e}")
        return

    # Create backup
    backup_path = file_path.with_suffix(file_path.suffix + ".bak")
    try:
        shutil.copy2(file_path, backup_path)
        print(f"  Backed up to {backup_path}")
    except Exception as e:
        print(f"  Failed to create backup: {e}")
        print("  Aborting to prevent data loss.")
        return

    images = data.get("images", [])
    if not images:
        print("  No images found.")
        return

    changed_count = 0

    for img in images:
        # 1. Reparse Overall
        overall = img.get("overall", {})
        if "raw_runs" in overall and overall["raw_runs"]:
            # Re-parse all runs
            new_runs = []
            for raw in overall["raw_runs"]:
                parsed = parse_overall_response(raw)
                # If parse failed (score is None), but we have raw, we keep it as is (None)
                # But hopefully the new regex fixes it.
                new_runs.append(parsed)
            
            # Re-merge
            merged = _merge_overall_runs(new_runs)
            # Preserve prompt if it exists
            if "prompt" in overall:
                merged["prompt"] = overall["prompt"]
            
            img["overall"] = merged
            changed_count += 1
        elif "raw" in overall and overall["raw"]:
            # Single run case
            parsed = parse_overall_response(overall["raw"])
            if "prompt" in overall:
                parsed["prompt"] = overall["prompt"]
            img["overall"] = parsed
            changed_count += 1

        # 2. Reparse Dimensions
        dims = img.get("dimensions", {})
        
        # We need to handle the structure. 
        # If it has "raw_runs" inside each dimension key? 
        # Wait, _merge_dimension_runs expects a list of dicts, where each dict has keys for all dimensions.
        # But the stored JSON structure is:
        # "dimensions": { "Expressiveness": { "score": ..., "raw_runs": [...] }, ... }
        # This is the AGGREGATED structure.
        # We need to reconstruct the "runs" list to pass to _merge_dimension_runs, OR just re-merge manually per dimension.
        
        # Actually, _merge_dimension_runs takes a list of "dimension_result" dicts (each containing all 3 dims).
        # But we don't have that easily accessible if we only stored the aggregated per-dimension lists.
        # Let's look at how `evaluate_image` produces it.
        # It produces `dimension_runs` which is a list of dicts: `[{ "Expressiveness": {...}, "Effectiveness": {...} }, ...]`
        # Then `_merge_dimension_runs` pivots this into `{"Expressiveness": {"score_runs": ...}, ...}`.
        
        # In the saved JSON, we have:
        # "dimensions": {
        #    "Expressiveness": { "score": X, "score_runs": [...], "raw_runs": [...] },
        #    ...
        # }
        # So we can just iterate over each dimension key, re-parse the `raw_runs`, and re-calculate mean.
        
        new_dims_aggregated = {}
        prompt = dims.get("prompt")
        
        for key in DIMENSION_KEYS:
            d_data = dims.get(key, {})
            if "raw_runs" in d_data and d_data["raw_runs"]:
                # Re-parse each raw run for this specific dimension
                # Note: parse_dimension_response returns a dict of ALL dimensions.
                # But here we only have the raw string for THIS dimension?
                # Wait, usually the LLM returns all dimensions in one string.
                # Let's check the JSON structure.
                # In `baseline_judge.py`:
                # dimension_result = parse_dimension_response(dimension_response)
                # dimension_runs.append(dimension_result)
                # Then `_merge_dimension_runs` stores `raw_runs` for each key.
                # `merged[key]["raw_runs"] = [run[key].get("raw") for run in runs]`
                # So `raw_runs` contains the FULL response string repeated? Or just the relevant part?
                # `parse_dimension_response` puts `response` into `parsed[key]["raw"]`.
                # So yes, `raw_runs` likely contains the full response string for each run.
                
                reparsed_scores = []
                reparsed_explains = []
                reparsed_raws = []
                
                for raw_text in d_data["raw_runs"]:
                    if not raw_text:
                        reparsed_scores.append(None)
                        reparsed_explains.append("Missing raw output")
                        reparsed_raws.append(None)
                        continue
                        
                    # Parse the full response again
                    full_parsed = parse_dimension_response(raw_text)
                    # Extract just this dimension
                    specific = full_parsed.get(key, {})
                    reparsed_scores.append(specific.get("score"))
                    reparsed_explains.append(specific.get("explain"))
                    reparsed_raws.append(raw_text)
                
                # Calculate mean
                valid_scores = [s for s in reparsed_scores if s is not None]
                from statistics import fmean
                mean_score = fmean(valid_scores) if valid_scores else None
                
                new_dims_aggregated[key] = {
                    "score": mean_score,
                    "explain": reparsed_explains[-1] if reparsed_explains else None, # Just take last? Or merge? The original code takes last.
                    "raw": reparsed_raws[-1] if reparsed_raws else None,
                    "score_runs": reparsed_scores,
                    "explain_runs": reparsed_explains,
                    "raw_runs": reparsed_raws
                }
            elif "raw" in d_data and d_data["raw"]:
                # Single run
                raw_text = d_data["raw"]
                full_parsed = parse_dimension_response(raw_text)
                specific = full_parsed.get(key, {})
                new_dims_aggregated[key] = {
                    "score": specific.get("score"),
                    "explain": specific.get("explain"),
                    "raw": raw_text
                }
            else:
                # No data, keep as is or empty
                new_dims_aggregated[key] = d_data
        
        if prompt:
            new_dims_aggregated["prompt"] = prompt
            
        img["dimensions"] = new_dims_aggregated
        changed_count += 1

    # Re-aggregate summary
    new_summary = aggregate_scores(images)
    data["summary"] = new_summary
    
    # Save
    print(f"  Updated {changed_count} images. Saving...")
    file_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

def main():
    task_outputs = REPO_ROOT / "task_outputs"
    files = list(task_outputs.rglob("baseline_scores__*.json"))
    print(f"Found {len(files)} baseline score files.")
    
    for f in files:
        reparse_file(f)

if __name__ == "__main__":
    main()
