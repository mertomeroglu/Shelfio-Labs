import { describe, expect, it } from 'vitest';
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { vi } from 'vitest';
import LocationPlanCanvas from './LocationPlanCanvas.jsx';
import {
  calculateLayoutBounds,
  getPlanDetailLevel,
  getRotatedBounds,
  includeBoundaryInBounds,
  rotatePoint,
} from './LocationPlanCanvas.jsx';

globalThis.PointerEvent ??= MouseEvent;

describe('LocationPlanCanvas helpers', () => {
  it('calculates layout boundaries in one reduced result', () => {
    expect(calculateLayoutBounds([
      { x: 100, y: 80, width: 40, height: 20 },
      { x: -20, y: 150, width: 30, height: 60 },
    ])).toEqual({
      minX: -20,
      maxX: 140,
      minY: 80,
      maxY: 210,
    });
  });

  it('uses stable level-of-detail thresholds', () => {
    expect(getPlanDetailLevel(0.6)).toBe('overview');
    expect(getPlanDetailLevel(1)).toBe('standard');
    expect(getPlanDetailLevel(1.4)).toBe('detail');
  });

  it('includes the store boundary and swaps fit bounds at quarter turns', () => {
    const bounds = includeBoundaryInBounds(
      { minX: 100, maxX: 300, minY: 100, maxY: 200 },
      { x: 50, y: 60, width: 400, height: 240 }
    );
    expect(bounds).toEqual({ minX: 50, maxX: 450, minY: 60, maxY: 300 });
    expect(getRotatedBounds(bounds, 90)).toEqual({
      minX: 130,
      maxX: 370,
      minY: -20,
      maxY: 380,
    });
  });

  it('rotates focus points around the plan center', () => {
    const point = rotatePoint({ x: 150, y: 100 }, { x: 100, y: 100 }, 90);
    expect(point.x).toBeCloseTo(100);
    expect(point.y).toBeCloseTo(150);
  });

  it('keeps object selection separate from an intentional background click', () => {
    const onSelectObject = vi.fn();
    const item = {
      id: 'section-1',
      objectType: 'section',
      x: 10,
      y: 10,
      width: 50,
      height: 120,
      label: 'Temel Gıda',
      metadata: {},
    };
    const { container } = render(React.createElement(LocationPlanCanvas, {
      items: [item],
      onSelectObject,
      setZoom: vi.fn(),
      setPan: vi.fn(),
      visibleTypes: new Set(),
      boundaries: [{ x: 0, y: 0, width: 100, height: 160 }],
    }));

    const object = container.querySelector('.lm-plan-object');
    const wrapper = container.querySelector('.lm-plan-canvas-wrapper');

    fireEvent.pointerDown(object, {
      button: 0,
      pointerId: 1,
      isPrimary: true,
    });
    fireEvent.pointerUp(wrapper, {
      pointerId: 1,
      isPrimary: true,
    });
    expect(onSelectObject).toHaveBeenLastCalledWith(item);

    fireEvent.pointerDown(wrapper, {
      button: 0,
      pointerId: 2,
      isPrimary: true,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerUp(wrapper, {
      pointerId: 2,
      isPrimary: true,
      clientX: 5,
      clientY: 5,
    });
    expect(onSelectObject).toHaveBeenLastCalledWith(null);
  });

  it('does not select decorative plan objects', () => {
    const onSelectObject = vi.fn();
    const aisle = {
      id: 'aisle-1',
      objectType: 'aisle',
      x: 10,
      y: 10,
      width: 160,
      height: 40,
      label: 'Koridor',
      metadata: {},
    };
    const { container } = render(React.createElement(LocationPlanCanvas, {
      items: [aisle],
      selectedObjectId: aisle.id,
      highlightedObjectId: aisle.id,
      onSelectObject,
      setZoom: vi.fn(),
      setPan: vi.fn(),
      visibleTypes: new Set(),
    }));
    const object = container.querySelector('.lm-plan-object');

    expect(object).toHaveClass('is-decorative');
    expect(object).not.toHaveClass('is-selected');
    expect(object).not.toHaveClass('is-highlighted');
    expect(container.querySelector('.lm-plan-hit-area')).toBeNull();

    fireEvent.click(object);

    expect(onSelectObject).not.toHaveBeenCalled();
  });

  it('pans from an object drag without clearing or changing selection', () => {
    const onSelectObject = vi.fn();
    const setPan = vi.fn();
    const item = {
      id: 'shelf-1',
      objectType: 'shelf',
      x: 10,
      y: 10,
      width: 70,
      height: 20,
      label: 'R01-L-01',
      metadata: { levels: [] },
    };
    const { container } = render(React.createElement(LocationPlanCanvas, {
      items: [item],
      selectedObjectId: item.id,
      onSelectObject,
      setZoom: vi.fn(),
      setPan,
      visibleTypes: new Set(),
      boundaries: [{ x: 0, y: 0, width: 300, height: 200 }],
    }));
    const object = container.querySelector('.lm-plan-object');
    const wrapper = container.querySelector('.lm-plan-canvas-wrapper');

    fireEvent.pointerDown(object, {
      button: 0,
      pointerId: 1,
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    });
    fireEvent.pointerMove(wrapper, { pointerId: 1, clientX: 50, clientY: 45 });
    expect(wrapper).toHaveClass('is-panning');
    fireEvent.pointerUp(wrapper, { pointerId: 1, clientX: 50, clientY: 45 });
    fireEvent.click(object);

    expect(setPan).toHaveBeenCalled();
    expect(onSelectObject).not.toHaveBeenCalled();
    expect(wrapper).not.toHaveClass('is-panning');
  });

  it('does not pan below the drag threshold and keeps object click selection', () => {
    const onSelectObject = vi.fn();
    const item = {
      id: 'common-1',
      objectType: 'section_common_area',
      x: 10,
      y: 10,
      width: 100,
      height: 40,
      label: 'Ortak Reyon Alanı',
      metadata: {},
    };
    const { container } = render(React.createElement(LocationPlanCanvas, {
      items: [item],
      onSelectObject,
      setZoom: vi.fn(),
      setPan: vi.fn(),
      visibleTypes: new Set(),
    }));
    const object = container.querySelector('.lm-plan-object');
    const wrapper = container.querySelector('.lm-plan-canvas-wrapper');

    fireEvent.pointerDown(object, {
      button: 0,
      pointerId: 2,
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    });
    fireEvent.pointerMove(wrapper, { pointerId: 2, clientX: 23, clientY: 22 });
    fireEvent.pointerUp(wrapper, { pointerId: 2, clientX: 23, clientY: 22 });
    fireEvent.click(object);

    expect(wrapper).not.toHaveClass('is-panning');
    expect(onSelectObject).toHaveBeenLastCalledWith(item);
  });
});
