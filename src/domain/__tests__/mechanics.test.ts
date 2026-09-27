import { describe, expect, it } from 'vitest';
import { WEATHERS, TERRAINS } from '../battle/conditions';
import { ABILITY_INTERACTIONS, ITEM_INTERACTIONS, terrainInfo, weatherInfo } from '../mechanics';

describe('field-effect glossary', () => {
  it('has info for every non-empty weather and terrain, and null for "None"', () => {
    for (const w of WEATHERS) {
      const info = weatherInfo(w.id);
      if (w.id === '') expect(info).toBeNull();
      else {
        expect(info).not.toBeNull();
        expect(info!.effects.length).toBeGreaterThan(0);
        expect(info!.interactions.length).toBeGreaterThan(0);
      }
    }
    for (const t of TERRAINS) {
      const info = terrainInfo(t.id);
      if (t.id === '') expect(info).toBeNull();
      else {
        expect(info).not.toBeNull();
        expect(info!.effects.length).toBeGreaterThan(0);
        expect(info!.interactions.length).toBeGreaterThan(0);
      }
    }
  });

  it('labels Snow as Hail in pre-Gen-9 formats without claiming the Defense boost', () => {
    const modern = weatherInfo('Snow', 'Snow');
    const legacy = weatherInfo('Snow', 'Hail');
    expect(modern!.name).toBe('Snow');
    expect(legacy!.name).toBe('Hail');
    expect(legacy!.effects.join(' ')).not.toMatch(/Defense boost/);
  });

  it('documents Grassy Terrain halving Earthquake and Misty Terrain halving Dragon damage', () => {
    expect(terrainInfo('Grassy')!.effects.join(' ')).toMatch(/Earthquake.*half damage/);
    expect(terrainInfo('Misty')!.effects.join(' ')).toMatch(/Dragon-type move damage ×0\.5/);
  });

  it('keys ability/item interaction notes by the dataset id (lowercase, no punctuation)', () => {
    expect(ABILITY_INTERACTIONS.chlorophyll).toBeDefined();
    expect(ABILITY_INTERACTIONS.grasspelt).toBeDefined();
    expect(ITEM_INTERACTIONS.utilityumbrella).toBeDefined();
    expect(ITEM_INTERACTIONS.boosterenergy).toBeDefined();
  });
});
