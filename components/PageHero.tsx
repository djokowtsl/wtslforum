import React from 'react';

export default function PageHero({ eyebrow, title, children, actions, className }: { eyebrow: string; title: string; children?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={['page-hero', className].filter(Boolean).join(' ')}>
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
