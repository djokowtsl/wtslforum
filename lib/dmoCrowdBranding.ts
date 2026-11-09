export type CrowdBannerBranding = {
  label: 'WTSL' | 'ACE';
  mascot: 'rally-fox' | null;
};

/** A sparse, repeatable banner mix keeps crowd color personal rather than commercial. */
export function getCrowdBannerBranding(index: number): CrowdBannerBranding {
  return {
    label: index % 2 ? 'WTSL' : 'ACE',
    mascot: index % 3 === 0 ? 'rally-fox' : null,
  };
}
