# Rampart fine-tuning preparation

Fine-tuning is not performed by Obiter and requires a separately provisioned GPU environment. The private v2 corpus comprises synthetic UK legal documents generated with commercial LLMs and contains no real personal data; it is never a public artifact. Before any training run, execute `pnpm bench:guard` against the private corpus or a reviewed-run export. A non-zero result means it overlaps the public benchmark and must not be used for training.

```bash
git clone https://github.com/nationaldesignstudio/rampart
cd rampart
pip install torch transformers datasets onnx onnxruntime
pnpm --dir /path/to/obiter bench:guard
python scripts/train.py --train-data /path/to/obiter/data/synthetic/uk-legal-train/documents.jsonl --label-space /path/to/obiter/data/evals/redact/custom_label_space.json --output-dir /path/to/checkpoint
python scripts/export_onnx.py --checkpoint /path/to/checkpoint --output /path/to/rampart-legal-q4.onnx
```

Use Python 3.10+ and an NVIDIA T4 (16GB VRAM) or better. The planned 300-document corpus should take roughly one to two GPU hours; keep checkpoints outside the application repository.

## Deploy loop

1. Export only reviewed, organisation-separated data with `scripts/export-training-data.ts`.
2. Train and evaluate on a held-out validation split.
3. Store the checkpoint at a versioned, access-controlled object-storage path.
4. Point `REDACT_MODEL_ID` at the vetted checkpoint and restart the API.
5. Re-run `demo-fixture.docx` and compare against its expected-span metadata before promotion.

Never combine reviewed client data from different organisations. The generator uses fabricated data only.
