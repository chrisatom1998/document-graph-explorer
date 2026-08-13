import { describe, expect, it } from 'vitest';
import type { DocNode } from '../model/types';
import {
  codeLanguageForNode,
  codeLanguageOf,
  fileTypeChip,
  fileTypeLabel,
  isCodeBasename,
  isCodeExtension,
  selectedDocumentTitle,
} from './codeLanguage';

function codeNode(path: string, title = 'Session'): Pick<DocNode, 'fileType' | 'path' | 'title'> {
  return { fileType: 'code', path, title };
}

describe('codeLanguageOf', () => {
  it('maps common source extensions to short language names', () => {
    expect(codeLanguageOf('src/app.ts')?.short).toBe('ts');
    expect(codeLanguageOf('App.tsx')?.short).toBe('tsx');
    expect(codeLanguageOf('main.js')?.short).toBe('js');
    expect(codeLanguageOf('Widget.jsx')?.short).toBe('jsx');
    expect(codeLanguageOf('train.py')?.short).toBe('py');
    expect(codeLanguageOf('lib.rs')?.short).toBe('rs');
    expect(codeLanguageOf('main.go')?.short).toBe('go');
  });

  it('uses human labels the reader can show', () => {
    expect(codeLanguageOf('auth.py')?.label).toBe('Python');
    expect(codeLanguageOf('session.ts')?.label).toBe('TypeScript');
    expect(codeLanguageOf('app.js')?.label).toBe('JavaScript');
  });

  it('recognizes special basenames even when they carry another extension', () => {
    expect(codeLanguageOf('Dockerfile')?.short).toBe('docker');
    expect(codeLanguageOf('Makefile')?.short).toBe('make');
    expect(codeLanguageOf('CMakeLists.txt')?.short).toBe('cmake');
    expect(codeLanguageOf('go.mod')?.short).toBe('go');
    expect(codeLanguageOf('Jenkinsfile')?.short).toBe('groovy');
  });

  it('covers languages that used to land in the ignored tray', () => {
    expect(codeLanguageOf('mix.exs')?.short).toBe('ex');
    expect(codeLanguageOf('Main.hs')?.short).toBe('hs');
    expect(codeLanguageOf('analysis.jl')?.short).toBe('jl');
    expect(codeLanguageOf('setup.ps1')?.short).toBe('ps1');
    expect(codeLanguageOf('schema.prisma')?.short).toBe('prisma');
    expect(codeLanguageOf('Page.astro')?.short).toBe('astro');
    expect(codeLanguageOf('Main.mojo')?.short).toBe('mojo');
    expect(codeLanguageOf('Lib.purs')?.short).toBe('purs');
    expect(codeLanguageOf('shader.glsl')?.short).toBe('glsl');
    expect(codeLanguageOf('kernel.ocl')?.short).toBe('ocl');
    expect(codeLanguageOf('build.ninja')?.short).toBe('ninja');
    expect(codeLanguageOf('taskfile.yml')?.short).toBe('task');
    expect(codeLanguageOf('data.avsc')?.short).toBe('avsc');
  });

  it('returns null for non-code names', () => {
    expect(codeLanguageOf('notes.md')).toBeNull();
    expect(codeLanguageOf('LICENSE')).toBeNull();
  });

  it('keeps Common Lisp on .cl instead of OpenCL', () => {
    expect(codeLanguageOf('util.cl')?.id).toBe('lisp');
    expect(codeLanguageOf('util.cl')?.family).toBe('other');
    expect(codeLanguageOf('kernel.ocl')?.id).toBe('opencl');
    expect(codeLanguageOf('kernel.opencl')?.id).toBe('opencl');
  });
});

describe('isCodeExtension / isCodeBasename', () => {
  it('flags routed source extensions and build-file basenames', () => {
    expect(isCodeExtension('ts')).toBe(true);
    expect(isCodeExtension('exs')).toBe(true);
    expect(isCodeExtension('pdf')).toBe(false);
    expect(isCodeBasename('Dockerfile')).toBe(true);
    expect(isCodeBasename('LICENSE')).toBe(false);
  });
});

describe('node display helpers', () => {
  it('keeps non-code chips as the FileType', () => {
    const md = { fileType: 'md' as const, title: 'Notes', path: 'notes.md' };
    expect(fileTypeChip(md)).toBe('md');
    expect(fileTypeLabel(md)).toBe('Markdown');
    expect(selectedDocumentTitle(md)).toBe('Notes');
    expect(codeLanguageForNode(md)).toBeNull();
  });

  it('shows the language on code chips, labels, and selected titles', () => {
    const py = codeNode('src/train.py', 'Train');
    expect(fileTypeChip(py)).toBe('py');
    expect(fileTypeLabel(py)).toBe('Python');
    expect(selectedDocumentTitle(py)).toBe('Train · py');

    const ts = codeNode('src/session.ts', 'Session');
    expect(fileTypeChip(ts)).toBe('ts');
    expect(fileTypeLabel(ts)).toBe('TypeScript');
    expect(selectedDocumentTitle(ts)).toBe('Session · ts');
  });

  it('does not duplicate a suffix already present in the title', () => {
    expect(selectedDocumentTitle(codeNode('a.ts', 'Session · ts'))).toBe('Session · ts');
    expect(selectedDocumentTitle(codeNode('a.ts', 'session.ts'))).toBe('session.ts');
  });
});
