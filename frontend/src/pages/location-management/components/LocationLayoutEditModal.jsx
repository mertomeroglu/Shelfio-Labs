import React from 'react';
import LocationLayoutEditorWorkspace from './LocationLayoutEditorWorkspace.jsx';

export default function LocationLayoutEditModal({
  isOpen,
  onClose,
  layout,
  onLayoutUpdated = () => {},
  canPublish = false,
}) {
  if (!isOpen) return null;

  return (
    <div className="lm-layout-editor-modal-overlay">
      <div className="lm-layout-editor-modal-container">
        <LocationLayoutEditorWorkspace
          layout={layout}
          onClose={onClose}
          onLayoutUpdated={onLayoutUpdated}
          canPublish={canPublish}
          isModal={true}
        />
      </div>
    </div>
  );
}
