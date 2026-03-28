import React from 'react';

const StatCard = ({ title, value, highlight }) => {
  const valueClass = highlight === 'green' ? 'glow-text-green' : 'glow-text-cyan';
  
  return (
    <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 600, letterSpacing: '1px' }}>{title}</span>
      <span className={valueClass} style={{ fontSize: '2rem', fontWeight: 800 }}>{value}</span>
    </div>
  );
};

export default StatCard;
