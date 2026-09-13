import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  asTemplateList,
  isGenuineEmptyTemplateList,
  templateListShapeHint,
} from '../src/lib/templateList.js';

const row = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Service agreement',
  signer_roles: [],
  blocks: [],
};

describe('asTemplateList', () => {
  it('reads { templates }', () => {
    assert.equal(asTemplateList({ templates: [row] })[0].id, row.id);
  });

  it('reads a top-level array (does not look for .templates on Array)', () => {
    assert.equal(asTemplateList([row]).length, 1);
  });

  it('parses a JSON string', () => {
    assert.equal(asTemplateList(JSON.stringify({ templates: [row] })).length, 1);
  });

  it('reads { items } and { template }', () => {
    assert.equal(asTemplateList({ items: [row] }).length, 1);
    assert.equal(asTemplateList({ template: row }).length, 1);
  });

  it('does not treat { templates: [] } as a parse miss', () => {
    const page = { templates: [] };
    const list = asTemplateList(page);
    assert.equal(list.length, 0);
    assert.equal(isGenuineEmptyTemplateList(page, list), true);
  });

  it('flags a string/object miss so checkout does not look like no template', () => {
    const page = '{"templates":[{"id":"x"}]}';
    const list = asTemplateList(page);
    assert.equal(list.length, 1);
    const emptyString = asTemplateList('');
    assert.equal(emptyString.length, 0);
    assert.equal(isGenuineEmptyTemplateList('', emptyString), false);
    assert.match(templateListShapeHint({ foo: 1 }), /keys foo/);
    const bogus = { notTemplates: row };
    assert.equal(asTemplateList(bogus).length, 0);
    assert.equal(isGenuineEmptyTemplateList(bogus, []), false);
  });
});
