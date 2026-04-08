# HAIChart Third-Party Component

This directory contains third-party code and assets derived from the HAIChart project.

Original repository:
https://github.com/HKUSTDial/HAIChart

## Purpose In This Repository

This component is included to support data preparation and chart-candidate generation used by the surrounding `vispuzzle` pipeline.

In the current repository layout, the main pipeline primarily uses:

- `datasets/` for bundled example CSV and auxiliary files
- `model.py` and related utility code used by the subtable extraction workflow

Other files in this directory are preserved for reproducibility and reference, but they are not all required by the default `main.py` workflow in the repository root.

## Reproducibility Note

The code in this directory is maintained here as a third-party dependency snapshot. Public release materials can restore fuller upstream attribution details if needed; for anonymous review, this file intentionally keeps the description minimal while preserving the original source location above.

## License

Please refer to the upstream project and any bundled license notices for the original licensing terms of the third-party material included here.
