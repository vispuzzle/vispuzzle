# Composite Visualization Generator

This repository generates composite visualizations with Monte Carlo Graph Search (MCGS) over chart candidates extracted from tabular data.

## Quick Start

1. Activate the conda environment

2. Install the top-level dependencies if needed:

```bash
pip install -r requirements.txt
```

3. Configure runtime environment variables:

```bash
export VISPUZZLE_RENDER_URL=http://localhost:9840/render
export NO_PROXY=localhost,127.0.0.1
# Required when embeddings, title generation, or scoring hit an LLM endpoint:
export VISPUZZLE_LLM_API_KEY=your_api_key
# Optional if you use an OpenAI-compatible gateway:
export VISPUZZLE_LLM_BASE_URL=https://your-endpoint/v1
```

4. Run the main pipeline:

```bash
python main.py --dataset olympics_2024
```

5. Render existing JSON outputs again if needed:

```bash
python test.py --dataset olympics_2024 --format svg
```

## Notes

- The main entrypoint is `main.py`.
- Outputs are written to `results/` and `data/` by default, or to `--output-dir` if provided.
- The local render service must expose `POST /render`.
- The repository currently ships cached embeddings for bundled examples; generating new embeddings requires an LLM API key.
- `LLMChart/HAIChart/requirements.txt` is for the legacy HAIChart demo and user-model codepath, not for the main pipeline tested above.
