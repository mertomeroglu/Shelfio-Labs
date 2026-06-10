import React from 'react';
import { ZoomIn, ZoomOut, Maximize2, Grid, RotateCcw, RotateCw, Save, Send, X, AlertCircle } from 'lucide-react';

export default function LocationLayoutToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onFit,
  snapEnabled,
  onToggleSnap,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onSave,
  onPublish,
  onCancel,
  isDirty,
  saveStatus,
  publishStatus,
  canPublish,
}) {
  return (
    <div className="lm-layout-toolbar">
      <div className="lm-layout-toolbar-group">
        <button className="ghost-button" type="button" title="Yakınlaştır" onClick={onZoomIn}>
          <ZoomIn size={16} />
        </button>
        <span className="lm-layout-toolbar-zoom-pct">{Math.round(zoom * 100)}%</span>
        <button className="ghost-button" type="button" title="Uzaklaştır" onClick={onZoomOut}>
          <ZoomOut size={16} />
        </button>
        <button className="ghost-button lm-layout-toolbar-fit-btn" type="button" title="Görünümü Sığdır" onClick={onFit}>
          <Maximize2 size={16} />
          <span>Görünümü Sığdır</span>
        </button>
      </div>

      <div className="lm-layout-toolbar-group">
        <button
          className={`ghost-button lm-layout-toolbar-snap-btn ${snapEnabled ? 'is-active-btn' : ''}`}
          type="button"
          title="Grid Kılavuzuna Hizala"
          onClick={onToggleSnap}
        >
          <Grid size={16} />
          <span>Snap {snapEnabled ? 'Açık' : 'Kapalı'}</span>
        </button>

        <span className="lm-layout-toolbar-divider" />

        <button className="ghost-button lm-layout-toolbar-history-btn" type="button" title="Geri Al (Ctrl/Cmd+Z)" onClick={onUndo} disabled={!canUndo}>
          <RotateCcw size={16} />
          <span>Geri Al</span>
        </button>
        <button className="ghost-button lm-layout-toolbar-history-btn" type="button" title="İleri Al (Ctrl+Y / Cmd+Shift+Z)" onClick={onRedo} disabled={!canRedo}>
          <RotateCw size={16} />
          <span>İleri Al</span>
        </button>
      </div>

      <div className="lm-layout-toolbar-group lm-layout-toolbar-status">
        {isDirty ? (
          <span className="lm-layout-dirty-badge">
            <AlertCircle size={14} />
            Kaydedilmemiş Değişiklikler Var
          </span>
        ) : null}
      </div>

      <div className="lm-layout-toolbar-group lm-layout-toolbar-actions">
        <button className="secondary-button lm-layout-toolbar-action" type="button" onClick={onCancel}>
          <X size={14} />
          <span>Vazgeç</span>
        </button>

        <button
          className="primary-button lm-layout-toolbar-action"
          type="button"
          onClick={onSave}
          disabled={saveStatus === 'saving' || !isDirty}
        >
          <Save size={14} />
          <span>{saveStatus === 'saving' ? 'Kaydediliyor...' : 'Taslak Kaydet'}</span>
        </button>

        {canPublish ? (
          <button
            className="primary-button lm-publish-btn lm-layout-toolbar-action"
            type="button"
            onClick={onPublish}
            disabled={publishStatus === 'publishing'}
          >
            <Send size={14} />
            <span>{publishStatus === 'publishing' ? 'Yayınlanıyor...' : 'Yayınla'}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
