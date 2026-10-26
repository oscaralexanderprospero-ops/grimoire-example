"""Normalize unsigned ZIP paths; validate exact signed APK asset names without extraction."""

import argparse

import json

import pathlib

import re

import zipfile

from html.parser import HTMLParser

from urllib.parse import urlsplit





def normalize(source, destination):

    seen = set()

    with zipfile.ZipFile(source) as src, zipfile.ZipFile(destination, 'x') as dst:

        for item in src.infolist():

            original = item.orig_filename

            name = original.replace('\\', '/')

            if name in seen or name.startswith('/') or '..' in name.split('/'):

                raise ValueError('Unsafe or duplicate normalized ZIP path')

            seen.add(name)

            data = src.read(item)

            item.filename = name

            dst.writestr(item, data)





def verify(apk):

    with zipfile.ZipFile(apk) as z:

        names = [item.orig_filename for item in z.infolist()]

        if any('\\' in n for n in names) or len(set(names)) != len(names):

            raise ValueError('Backslash or duplicate APK entries')

        if z.testzip() is not None:

            raise ValueError('ZIP CRC failure')

        required = {'assets/web/' + n for n in

                    ['index.html', 'app.js', 'model.js', 'data.js', 'offline.js',

                     'sync.js', 'styles.css', 'manifest.webmanifest', 'owner-seed.json']}



        def reference(value, base='assets/web'):

            u = urlsplit(value)

            if u.scheme or u.netloc or not u.path:

                return

            path = pathlib.PurePosixPath(base, u.path)

            if u.path.startswith('/') or '..' in path.parts or '\\' in value:

                raise ValueError('Unsafe packaged reference')

            required.add(str(path))



        class References(HTMLParser):

            def handle_starttag(self, tag, attrs):

                for key, value in attrs:

                    if value and (key == 'src' or tag == 'link' and key == 'href'):

                        reference(value)



        References().feed(z.read('assets/web/index.html').decode('utf-8-sig'))

        manifest = json.loads(z.read('assets/web/manifest.webmanifest'))

        for icon in manifest.get('icons', []):

            reference(icon['src'])

        for value in re.findall(r'url\([\s\"\']*([^\)\"\']+)', z.read('assets/web/styles.css').decode()):

            reference(value.strip())

        missing = sorted(required - set(names))

        if missing:

            raise ValueError('Missing exact AssetManager paths: ' + ', '.join(missing))

        print(json.dumps({'apk': str(apk), 'backslash_entries': 0,

                          'validated_asset_paths': sorted(required), 'zip_crc': 'passed'}))





if __name__ == '__main__':

    p = argparse.ArgumentParser()

    p.add_argument('action', choices=['normalize', 'verify'])

    p.add_argument('apk')

    p.add_argument('destination', nargs='?')

    a = p.parse_args()

    if a.action == 'normalize':

        normalize(a.apk, a.destination)

    else:

        verify(a.apk)

