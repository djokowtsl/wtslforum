import React from 'react';

export default function PageHero({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="page-hero">
      <div className="page-hero-inner">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="display">{title}</h1>
          {children && <p>{children}</p>}
        </div>
        {actions && <div>{actions}</div>}
      </div>
    </section>
  );
}
