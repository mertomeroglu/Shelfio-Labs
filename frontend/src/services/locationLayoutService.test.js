import { describe, expect, it } from 'vitest';
import {
  collapseLayoutItemsForPlan,
  resolveLayoutBoundaries,
  resolveLayoutBoundary,
} from './locationLayoutService.js';

describe('location layout plan projection', () => {
  it('collapses published shelf levels into one read-only stack without mutating source items', () => {
    const items = [1, 2].map((level) => ({
      id: `level-${level}`,
      objectType: 'shelf',
      x: 20,
      y: 40 + level * 4,
      width: 30,
      height: 15,
      linkedSectionId: 'section-1',
      locationCodeSnapshot: `R01-L-02-0${level}`,
      metadata: {
        shelfSide: 'L',
        shelfNo: 2,
        shelfLevel: level,
        products: [{ id: `product-${level}`, name: `Ürün ${level}`, sku: `SKU-${level}` }],
      },
    }));

    const projected = collapseLayoutItemsForPlan(items);

    expect(projected).toHaveLength(1);
    expect(projected[0].locationCodeSnapshot).toBe('R01-L-02');
    expect(projected[0].metadata.levelCount).toBe(5);
    expect(projected[0].metadata.levels.map((level) => level.levelNo)).toEqual([1, 2, 3, 4, 5]);
    expect(projected[0].metadata.levels[4]).toMatchObject({
      levelNo: 5,
      shelfCode: 'R01-L-02-05',
      products: [],
      isEmpty: true,
    });
    expect(items[0].metadata.collapsedStack).toBeUndefined();
  });

  it('uses stored boundary and otherwise derives a padded fallback', () => {
    expect(resolveLayoutBoundary(
      { metadata: { boundary: { x: 1, y: 2, width: 3, height: 4 } } },
      []
    )).toEqual({ x: 1, y: 2, width: 3, height: 4 });

    expect(resolveLayoutBoundary(null, [
      { x: 100, y: 80, width: 20, height: 40 },
    ])).toEqual({ x: 58, y: 38, width: 104, height: 124 });
  });

  it('projects overlapping published warehouse items outside the store without mutating source coordinates', () => {
    const items = [
      { id: 'section', objectType: 'section', x: 0, y: 0, width: 200, height: 200, metadata: {} },
      {
        id: 'warehouse',
        objectType: 'warehouse_location',
        x: 100,
        y: 20,
        width: 50,
        height: 30,
        metadata: { rowNo: 1, side: 'L', shelfNo: 1, levelNo: 1 },
      },
    ];
    const projected = collapseLayoutItemsForPlan(items);
    const warehouse = projected.find((item) => item.objectType === 'warehouse_location');
    expect(warehouse.x).toBeGreaterThanOrEqual(350);
    expect(warehouse.metadata.levelCount).toBe(10);
    expect(warehouse.metadata.levels[9]).toMatchObject({
      levelNo: 10,
      shelfCode: 'D1-L-01-10',
      status: 'Boş',
      products: [],
    });
    expect(items[1].x).toBe(100);
  });

  it('resolves separate stored store and warehouse boundaries', () => {
    expect(resolveLayoutBoundaries({
      metadata: {
        boundaries: [
          { x: 0, y: 0, width: 200, height: 200, label: 'Mağaza Sınırı', type: 'store' },
          { x: 300, y: 0, width: 100, height: 200, label: 'Depo Sınırı', type: 'warehouse' },
        ],
      },
    }, [])).toHaveLength(2);
  });
});
