import { describe, expect, it } from 'vitest';
import { canonicalTerm, entityKey, phraseRespellings, termVariants } from './aliases';
import { extractEntities } from './entities';
import { entityEdges } from './entityLinks';
import { referenceEdges } from './links';
import { extractPhraseTf } from './phrases';
import { tokenize } from './tokenize';
import { lexicalRelevance } from '../search/retrieval';

describe('spelling variants', () => {
  it('folds known product spellings to one term', () => {
    expect(canonicalTerm('postgresql')).toBe('postgres');
    expect(canonicalTerm('k8s')).toBe('kubernetes');
    expect(canonicalTerm('postgres')).toBe('postgres');
    expect(canonicalTerm('elastic')).toBe('elastic');
    expect(termVariants('postgresql')).toEqual(['postgresql', 'postgres', 'pgsql']);
    expect(termVariants('deploy')).toEqual(['deploy']);
  });

  it('gives one entity key to one name in any case, separator or number', () => {
    const key = entityKey('dependency_groups');
    expect(entityKey('Dependency Groups')).toBe(key);
    expect(entityKey('Dependency Group')).toBe(key);
    expect(entityKey('DependencyGroup')).toBe(key);
    expect(entityKey('TypeVarTuples')).toBe(entityKey('TypeVarTuple'));
    expect(entityKey('PostgreSQL')).toBe('postgres');
    // Acronyms keep their case; 'Process' is not a plural.
    expect(entityKey('IT')).toBe('IT');
    expect(entityKey('Process')).toBe('process');
  });

  it('tokenizes Postgres and PostgreSQL to the same keyword and phrase', () => {
    expect(tokenize('PostgreSQL replication')).toEqual(tokenize('Postgres replication'));
    expect(Object.keys(extractPhraseTf('PostgreSQL logical replication. PostgreSQL logical replication.'))).toContain(
      'postgres logical replication',
    );
  });

  it('pools one name written two ways into a single entity slot', () => {
    const entities = extractEntities(
      'Each dependency_groups table holds Dependency Groups. Dependency Groups nest. Dependency Groups resolve.',
    );
    expect(entities.filter((e) => entityKey(e) === entityKey('dependency_groups'))).toEqual(['Dependency Groups']);
  });

  it('links docs that name the same identifier in different conventions', () => {
    const edges = entityEdges(
      [
        { id: 'a', entities: ['refresh_token_flow', 'AuthService'] },
        { id: 'b', entities: ['RefreshTokenFlow', 'auth_service'] },
        { id: 'c', entities: ['Unrelated'] },
      ],
      { minShared: 2, edgesPerDoc: 5 },
    );
    expect(edges.map((e) => `${e.source}-${e.target}`)).toEqual(['a-b']);
    expect(edges[0]!.evidence[0]).toContain("'refresh_token_flow'");
  });

  it('cites a title written with another spelling', () => {
    expect(phraseRespellings('Postgres Upgrade Plan')).toEqual(['postgresql upgrade plan', 'pgsql upgrade plan']);
    expect(phraseRespellings('Upgrade Plan')).toEqual([]);
    const doc = (id: string, title: string, text: string) => ({
      id, title, fileName: `${id}.md`, path: `${id}.md`, textLower: text.toLowerCase(), mdLinkTargets: [],
    });
    const edges = referenceEdges(
      [doc('plan', 'Postgres Upgrade Plan', 'Steps.'), doc('notes', 'Weekly Notes', 'See the PostgreSQL Upgrade Plan.')],
      6,
    );
    expect(edges.map((e) => `${e.source}-${e.target}`)).toEqual(['notes-plan']);
  });

  it('finds Postgres docs when searching for PostgreSQL, and the reverse', () => {
    expect(lexicalRelevance('PostgreSQL', 'Tune Postgres autovacuum.').score).toBeGreaterThan(0);
    expect(lexicalRelevance('postgres', 'Tune PostgreSQL autovacuum.').score).toBeGreaterThan(0);
    expect(lexicalRelevance('k8s', 'Kubernetes ingress rules').score).toBeGreaterThan(0);
    expect(lexicalRelevance('PostgreSQL', 'Tune MySQL autovacuum.').score).toBe(0);
  });
});
