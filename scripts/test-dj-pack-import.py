"""Self-contained pack import regression tests; does not change the user's review data."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import threading
import urllib.request
import urllib.error
from urllib.parse import urlencode
from unittest.mock import patch
import zipfile

import dj_pack_import as packs

spec = importlib.util.spec_from_file_location('review_server', Path(__file__).with_name('dj-review-server.py'))
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class PackImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.original = review.DATA
        review.DATA = self.root / 'review'
        review.DATA.mkdir()
        self.info = packs.metadata({'name':'Test pack','sourceUrl':'https://example.org/pack','licenseUrl':'https://example.org/license'})

    def tearDown(self):
        review.DATA = self.original
        self.temp.cleanup()

    def archive(self, entries):
        path = self.root/'test.zip'
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
            for name, data in entries:
                z.writestr(name, data)
        return path

    def test_retains_archive_source_and_flattens_audio(self):
        archive = self.archive([('folder/kick.wav',b'kick'),('LICENSE.txt',b'CC0')])
        staged = packs.stage_archive(archive, review.DATA, self.info)
        self.assertEqual(len(staged),1)
        self.assertEqual(staged[0]['path'].read_bytes(),b'kick')
        self.assertEqual(staged[0]['packSource']['archiveMember'],'folder/kick.wav')
        retained = next((review.DATA/'packs').glob('*/original.archive'))
        with zipfile.ZipFile(retained) as z:
            self.assertEqual(z.read('LICENSE.txt'),b'CC0')
        self.assertIn('Needs review',staged[0]['packSource']['license'])

    def test_rejects_traversal_empty_and_excessive_packs(self):
        for entries in [ [('../escape.wav',b'x')], [('readme.txt',b'no audio')], [(str(i)+'.wav',b'x') for i in range(301)] ]:
            with self.assertRaises(ValueError):
                packs.stage_archive(self.archive(entries), review.DATA, self.info)
        self.assertFalse((self.root/'escape.wav').exists())

    def test_bounded_decompression(self):
        with self.assertRaises(ValueError):
            packs.tar_read(self.archive([('large.wav',b'x'*1000)]),'large.wav',10)

    def test_rejects_untrusted_remote_download(self):
        with self.assertRaises(ValueError):
            packs.download_pack('http://127.0.0.1/private',self.root/'bad')
        redirect = packs.PackRedirect()
        with self.assertRaises(ValueError):
            redirect.redirect_request(None,None,302,'',{},'http://127.0.0.1/private')

    def test_batch_deduplicates_preserves_reviews_and_keeps_labels_unconfirmed(self):
        archive = self.archive([('one.wav',b'one'),('copy.wav',b'one'),('two.wav',b'two')])
        original_reviews = {'older':{'confirmed':True,'labels':{'source':['voice'],'production':[],'character':[]}}}
        review.write(review.DATA/'reviews.json',original_reviews)
        def command(args, log, timeout=600):
            if args[0] == 'npx':
                output = Path(args[args.index('--output')+1])
                files = args[args.index('--output')+2:]
                review.write(output,{'results':[{'file':f,'seconds':1,'tags':[],'embedding':[0.1]*512} for f in files]})
        with patch.object(review,'command',side_effect=command):
            result = review.process_pack(archive,self.info,lambda _:None)
            repeat = review.process_pack(archive,self.info,lambda _:None)
        self.assertEqual((result['added'],result['skipped']),(2,1))
        self.assertEqual((repeat['added'],repeat['skipped']),(0,3))
        items = review.read(review.DATA/'manifest.json')['items']
        self.assertTrue(all(not i['reviewed'] and i['proposedLabels']=={'source':[],'production':[],'character':[]} for i in items))
        self.assertTrue(all('packSource' in i for i in items))
        self.assertEqual(review.read(review.DATA/'reviews.json'),original_reviews)

    def test_pack_http_routes_require_token_and_accept_archive_metadata(self):
        old_port, old_origin = review.PORT, review.ORIGIN
        server = review.ThreadingHTTPServer(('127.0.0.1',0),review.Handler)
        review.PORT = server.server_address[1]
        review.ORIGIN = f'http://127.0.0.1:{review.PORT}'
        threading.Thread(target=server.serve_forever,daemon=True).start()
        def post(path, body, token=True):
            req = urllib.request.Request(review.ORIGIN+path, data=body, headers={'Origin':review.ORIGIN,'X-Review-Token':review.TOKEN if token else 'wrong'})
            try:
                with urllib.request.urlopen(req) as response:
                    return response.status,json.load(response)
            except urllib.error.HTTPError as error:
                return error.code,json.load(error)
        try:
            with patch.object(review,'run_job',return_value={'jobId':'a'*24}) as job:
                body=json.dumps({'packId':'freepats-synth'}).encode()
                self.assertEqual(post('/api/packs',body,False)[0],403)
                job.assert_not_called()
                self.assertEqual(post('/api/packs',body)[0],202)
                self.assertEqual(post('/api/packs',b'{"packId":"unknown"}')[0],400)
                archive=self.archive([('one.wav',b'one')]).read_bytes()
                self.assertEqual(post('/api/pack-archive',archive)[0],400)
                self.assertEqual(post('/api/pack-archive?'+urlencode(self.info),archive)[0],202)
        finally:
            server.shutdown();server.server_close()
            review.PORT,review.ORIGIN=old_port,old_origin


if __name__ == '__main__':
    unittest.main()
