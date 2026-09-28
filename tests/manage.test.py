"""Filesystem safety checks with stubbed Docker/curl; no VM or containers required."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]


class ManagementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.live = self.base / 'opt/teamspace'
        self.old = self.base / 'opt/nextcloud'
        self.events = self.base / 'events'
        self.env = dict(os.environ, EVENTS=str(self.events))
        bindir = self.base / 'bin'
        bindir.mkdir()
        chown = bindir / 'chown'
        chown.write_text('#!/bin/sh\nexit 0\n')
        chown.chmod(0o755)
        self.env['PATH'] = str(bindir) + ':' + os.environ['PATH']
        docker = bindir / 'docker'
        docker.write_text('''#!/usr/bin/env python3
import os,sys,json
args=sys.argv[1:]
with open(os.environ['EVENTS'],'a') as f:f.write(json.dumps(args)+'\\n')
if args[0]=='inspect': print('true' if 'Running' in ' '.join(args) else 'healthy')
elif args[:2]==['image','inspect']: print('["example@sha256:test"]')
elif args[0]=='compose':
 if 'ps' in args and '-q' in args: print(args[-1])
 elif 'pg_dump' in args: print('database fixture')
 elif 'images' in args and '-q' in args: print('image-fixture')
''')
        docker.chmod(0o755)
        curl = bindir / 'curl'
        curl.write_text('#!/bin/sh\necho "{\\"ok\\":true}"\n')
        curl.chmod(0o755)
        self.release(self.live)

    def release(self, target):
        target.mkdir(parents=True, exist_ok=True)
        for item in ['api','web','scripts','tests','terraform']:
            (target/item).mkdir(exist_ok=True)
            (target/item/'current.txt').write_text('new')
        for item in ['package.json','package-lock.json','Dockerfile.api','Dockerfile.web',
                     'nginx.conf','compose.yaml','.env.example','.dockerignore',
                     '.gitignore','.gitattributes','README.md']:
            (target/item).write_text('fixture')
        script = (SOURCE/'scripts/manage.sh').read_text()
        script = script.replace('[[ $EUID -eq 0 ]]', 'true')
        script = script.replace('/opt/teamspace', str(self.live)).replace('/opt/nextcloud', str(self.old))
        script = script.replace('/opt/.teamspace-release.', str(self.base/'opt/.teamspace-release.'))
        script = script.replace('-C /opt teamspace', '-C '+str(self.base/'opt')+' teamspace')
        script = script.replace('/srv/nextcloud', str(self.base/'data'))
        script = script.replace('/var/backups/teamspace', str(self.base/'backups/teamspace'))
        script = script.replace('/run/teamspace-management.lock', str(self.base/'management.lock'))
        (target/'scripts/manage.sh').write_text(script)

    def configure(self, target):
        (target/'.env').write_text('UI_ORIGIN=http://demo.example:8081\n')
        (target/'secrets').mkdir()
        for name in ['admin_password','db_password']:
            (target/'secrets'/name).write_text('original-'+name)

    def run_command(self, root, command, success=True):
        result = subprocess.run(['bash', str(root/'scripts/manage.sh'), command],
                                env=self.env, text=True, capture_output=True)
        if success: self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
        else: self.assertNotEqual(result.returncode, 0)
        return result

    def test_update_removes_obsolete_files_preserves_configuration_and_backup(self):
        self.configure(self.live)
        (self.live/'api/obsolete.js').write_text('old')
        (self.live/'notes.txt').write_text('operator notes')
        incoming=self.base/'incoming';self.release(incoming)
        self.run_command(incoming,'update')
        self.assertFalse((self.live/'api/obsolete.js').exists())
        self.assertTrue((self.live/'api/current.txt').exists())
        self.assertEqual((self.live/'notes.txt').read_text(),'operator notes')
        self.assertEqual((self.live/'secrets/db_password').read_text(),'original-db_password')
        self.assertIn('demo.example', (self.live/'.env').read_text())
        with tarfile.open(next((self.base/'backups/teamspace-code').glob('*.tar.gz'))) as archive:
            self.assertEqual(archive.extractfile('teamspace/api/obsolete.js').read(),b'old')
        self.assertFalse(list((self.base/'opt').glob('.teamspace-release.*')))

    def test_incomplete_release_leaves_live_code_untouched(self):
        self.configure(self.live)
        incoming=self.base/'incoming';self.release(incoming)
        (incoming/'package-lock.json').unlink()
        self.run_command(incoming,'update',False)
        self.assertTrue((self.live/'api/current.txt').exists())
        self.assertFalse(self.events.exists())

    def test_existing_data_never_gets_replacement_credentials(self):
        (self.live/'.env').write_text('UI_ORIGIN=http://example:8081\n')
        data=self.base/'data/postgres';data.mkdir(parents=True)
        (data/'PG_VERSION').write_text('16')
        self.run_command(self.live,'deploy',False)
        self.assertFalse((self.live/'secrets/db_password').exists())

    def test_backup_contains_database_files_and_secrets(self):
        self.configure(self.live)
        data=self.base/'data/html';data.mkdir(parents=True)
        (data/'document.txt').write_text('important file')
        self.run_command(self.live,'backup')
        backup=next((self.base/'backups/teamspace').iterdir())
        self.assertTrue((backup/'COMPLETE').exists())
        with tarfile.open(backup/'deployment.tar.gz') as archive:
            self.assertEqual(archive.extractfile('./secrets/db_password').read(),b'original-db_password')
        with tarfile.open(backup/'html.tar.gz') as archive:
            self.assertEqual(archive.extractfile('html/document.txt').read(),b'important file')
        events=[json.loads(x) for x in self.events.read_text().splitlines()]
        self.assertTrue(any('pg_dump' in e for e in events))
        self.assertIn('start',events[-1])

    def test_migration_preserves_secrets_origin_and_stops_legacy_before_start(self):
        self.release(self.old);self.configure(self.old)
        (self.old/'.env').write_text('NEXTCLOUD_IMAGE=nextcloud:33-apache\n')
        ui=self.old/'teamspace-ui';ui.mkdir()
        (ui/'compose.yaml').write_text('legacy')
        (ui/'.env').write_text('UI_ORIGIN=http://existing.example:8081\n')
        (self.old/'scripts/backup.sh').write_text('#!/bin/bash\ntouch "'+str(self.base/'legacy-backup')+'"\n')
        self.run_command(self.live,'migrate')
        self.assertTrue((self.base/'legacy-backup').exists())
        self.assertIn('existing.example', (self.live/'.env').read_text())
        self.assertEqual((self.live/'secrets/db_password').read_text(),'original-db_password')
        events=[json.loads(x) for x in self.events.read_text().splitlines()]
        downs=[i for i,e in enumerate(events) if 'down' in e]
        ups=[i for i,e in enumerate(events) if 'up' in e]
        self.assertEqual(len(downs),2)
        self.assertLess(max(downs),min(ups))
        self.assertTrue((self.old/'compose.yaml').exists())
        self.run_command(self.live,'migrate',False)


if __name__ == '__main__':
    unittest.main()
