/** Distinct licensed faces and authored casual outfits, not recoloured copies. */
export const DIVERSE_SPECTATORS = [
  'AIAN_F_1_Casual', 'AIAN_M_1_Casual', 'Asian_F_1_Casual', 'Asian_M_1_Casual',
  'Black_F_1_Casual', 'Black_M_1_Casual', 'Hispanic_F_1_Casual', 'Hispanic_M_1_Casual',
  'MENA_F_1_Casual', 'MENA_M_1_Casual', 'NHPI_M_1_Casual', 'NHPI_M_2_Casual',
  'White_F_1_Casual', 'White_M_1_Casual',
].map(name => ({
  id: `valid-${name.toLowerCase().replaceAll('_', '-')}`,
  gender: (name.includes('_F_') ? 'female' : 'male') as 'female' | 'male',
}));
