"""Offline build-download tests; no real network requests or Docker calls."""
import hashlib
import io
import json
from pathlib import Path
import ssl
import tempfile
import unittest
from unittest import mock
import urllib.error

from runtime import download_tool as tool

PAYLOAD = b'controlled tool bytes'


def response(payload=PAYLOAD, error=None):
    result = mock.MagicMock()
    result.__enter__.return_value = result
    result.read.return_value = payload
    result.read.side_effect = error
    return result


class Tests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.target = Path(directory) / 'yt-dlp'
        self.lock_path = Path(directory) / 'tools.lock.json'
        self.lock = json.loads(Path(tool.__file__).with_name('tools.lock.json').read_text())
        self.lock['ytDlpSha256'] = hashlib.sha256(PAYLOAD).hexdigest()
        self.lock_path.write_text(json.dumps(self.lock))
        self.open = self.enterContext(mock.patch.object(tool.urllib.request, 'urlopen'))
        self.sleep = self.enterContext(mock.patch.object(tool.time, 'sleep'))
        self.enterContext(mock.patch.object(tool.sys, 'stderr', io.StringIO()))

    def install(self):
        tool.install(self.lock_path, self.target)

    def http_error(self, code):
        return urllib.error.HTTPError(self.lock['ytDlpUrl'], code, 'fixture', {}, io.BytesIO())

    def test_success_uses_pinned_url_hash_and_bounded_read(self):
        received = response()
        self.open.return_value = received
        self.install()
        self.assertEqual(self.target.read_bytes(), PAYLOAD)
        self.open.assert_called_once_with(self.lock['ytDlpUrl'], timeout=30)
        received.read.assert_called_once_with(tool.MAX_BYTES + 1)
        received.__exit__.assert_called_once()
        self.sleep.assert_not_called()

    def test_transient_http_recovers(self):
        for code in (502, 503, 504):
            with self.subTest(code=code):
                self.open.reset_mock(); self.sleep.reset_mock()
                error = self.http_error(code)
                self.open.side_effect = [error, response()]
                self.install()
                self.assertTrue(error.closed)
                self.assertEqual(self.target.read_bytes(), PAYLOAD)
                self.assertEqual(self.open.call_count, 2)
                self.sleep.assert_called_once_with(2)

    def test_opening_timeouts_recover(self):
        for error in (TimeoutError(), urllib.error.URLError(TimeoutError())):
            with self.subTest(error=type(error).__name__):
                self.open.reset_mock(); self.sleep.reset_mock()
                self.open.side_effect = [error, response()]
                self.install()
                self.assertEqual(self.target.read_bytes(), PAYLOAD)
                self.sleep.assert_called_once_with(2)

    def test_read_timeout_discards_response_and_recovers(self):
        failed = response(error=TimeoutError())
        self.open.side_effect = [failed, response()]
        self.install()
        failed.__exit__.assert_called_once()
        self.assertEqual(self.target.read_bytes(), PAYLOAD)
        self.assertEqual(self.open.call_count, 2)
        self.sleep.assert_called_once_with(2)

    def test_transient_http_exhaustion_is_bounded(self):
        errors = [self.http_error(504) for _ in range(3)]
        self.open.side_effect = errors
        with self.assertRaises(urllib.error.HTTPError):
            self.install()
        self.assertEqual(self.open.call_count, 3)
        self.assertEqual(self.sleep.call_args_list, [mock.call(2), mock.call(4)])
        self.assertTrue(all(error.closed for error in errors))
        self.assertFalse(self.target.exists())

    def test_timeout_exhaustion_is_bounded(self):
        self.open.side_effect = TimeoutError()
        with self.assertRaises(TimeoutError):
            self.install()
        self.assertEqual(self.open.call_count, 3)
        self.assertEqual(self.sleep.call_args_list, [mock.call(2), mock.call(4)])
        self.assertFalse(self.target.exists())

    def test_non_transient_http_errors_fail_immediately(self):
        for code in (400, 401, 403, 404, 408, 429, 500):
            with self.subTest(code=code):
                self.open.reset_mock(); self.sleep.reset_mock()
                self.open.side_effect = self.http_error(code)
                with self.assertRaises(urllib.error.HTTPError):
                    self.install()
                self.open.assert_called_once()
                self.sleep.assert_not_called()
                self.assertFalse(self.target.exists())

    def test_tls_and_other_network_errors_fail_immediately(self):
        failures = [ssl.SSLCertVerificationError('fixture'), ssl.SSLError('fixture'),
                    urllib.error.URLError(ssl.SSLCertVerificationError('fixture')),
                    urllib.error.URLError(ssl.SSLError('fixture')),
                    urllib.error.URLError('timed out'), urllib.error.URLError(ConnectionError())]
        for error in failures:
            with self.subTest(error=repr(error)):
                self.open.reset_mock(); self.sleep.reset_mock()
                self.open.side_effect = error
                with self.assertRaises(type(error)):
                    self.install()
                self.open.assert_called_once()
                self.sleep.assert_not_called()
                self.assertFalse(self.target.exists())

    def test_hash_mismatch_fails_without_overwriting_destination(self):
        self.target.write_bytes(b'existing verified tool')
        self.open.return_value = response(b'wrong tool')
        with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
            self.install()
        self.assertEqual(self.target.read_bytes(), b'existing verified tool')
        self.open.assert_called_once()
        self.sleep.assert_not_called()

    def test_oversized_response_fails_without_writing(self):
        self.open.return_value = response(PAYLOAD + b'x')
        with mock.patch.object(tool, 'MAX_BYTES', len(PAYLOAD)):
            with self.assertRaisesRegex(ValueError, 'size limit'):
                self.install()
        self.assertFalse(self.target.exists())
        self.open.assert_called_once()
        self.sleep.assert_not_called()

    def test_exact_size_limit_is_accepted(self):
        self.open.return_value = response()
        with mock.patch.object(tool, 'MAX_BYTES', len(PAYLOAD)):
            self.install()
        self.assertEqual(self.target.read_bytes(), PAYLOAD)
        self.sleep.assert_not_called()
