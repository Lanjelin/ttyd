import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// Inline only the local asset tags emitted by src/template.html and webpack.
const dist = new URL('./dist/', import.meta.url);
const asset = name => readFileSync(new URL(name, dist));
const html = asset('index.html')
    .toString('utf8')
    .replace(/<link\b[^>]*\binline\b[^>]*>/gi, tag => {
        const href = /\bhref="([^"]+)"/.exec(tag)[1];
        if (/\brel="icon"/.test(tag)) {
            return tag.replace(/\sinline(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/, '').replace(href, `data:image/png;base64,${asset(href).toString('base64')}`);
        }
        return `<style>${asset(href).toString('utf8').replace(/<\/style/gi, '<\\/style')}</style>`;
    })
    .replace(/<script\b[^>]*\binline\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gi, (_, src) => {
        return `<script>${asset(src).toString('utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
    });

writeFileSync(new URL('inline.html', dist), html);

if (!process.argv.includes('--inline')) {
    const contents = Buffer.from(html);
    const compressed = gzipSync(contents);
    const lines = [];
    for (let offset = 0; offset < compressed.length; offset += 12) {
        lines.push(
            '  ' + Array.from(compressed.subarray(offset, offset + 12), value => `0x${value.toString(16).padStart(2, '0')}`).join(', ')
        );
    }
    const header = [
        `unsigned char index_html[] = {\n${lines.join(',\n')}\n};`,
        `unsigned int index_html_len = ${compressed.length};`,
        `unsigned int index_html_size = ${contents.length};`,
        '',
    ].join('\n');
    writeFileSync(new URL('../src/html.h', import.meta.url), header);
}
