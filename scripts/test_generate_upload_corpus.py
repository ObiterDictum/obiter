import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "generate_upload_corpus", Path(__file__).with_name("generate-upload-corpus.py")
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SurgeryTests(unittest.TestCase):
    def test_rebuild_replaces_entries_and_cleans_temporary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.docx"
            output = root / "output.docx"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("part.xml", b"old")

            def surgery(archive, _etree):
                archive.writestr("part.xml", b"new")

            with patch("tempfile.tempdir", directory):
                module._save_and_surgery_doc(source, output, surgery)
            with zipfile.ZipFile(output) as archive:
                self.assertEqual(archive.read("part.xml"), b"new")
            self.assertEqual(sorted(p.name for p in root.iterdir()), ["output.docx", "source.docx"])

    def test_failed_surgery_cleans_temporary_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.docx"
            with zipfile.ZipFile(source, "w") as archive:
                archive.writestr("part.xml", b"old")

            def surgery(_archive, _etree):
                raise ValueError("failure")

            with patch("tempfile.tempdir", directory), self.assertRaises(ValueError):
                module._save_and_surgery_doc(source, root / "output.docx", surgery)
            self.assertEqual([p.name for p in root.iterdir()], ["source.docx"])


if __name__ == "__main__":
    unittest.main()
