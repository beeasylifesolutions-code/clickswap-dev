// The store categories everyone picks from. Used by the Swap ads page,
// the Safety page and the ad picker.
export const NORMAL_CATEGORIES = [
  "Apparel & accessories",
  "Beauty & personal care",
  "Food & drink",
  "Health & wellness",
  "Home & garden",
  "Electronics & gadgets",
  "Jewelry & watches",
  "Pets",
  "Sports & outdoors",
  "Toys, kids & baby",
  "Arts & crafts",
  "Other",
];

// Hidden from every store unless that store opts in on the Safety page
export const RESTRICTED_CATEGORIES = [
  "Adult (18+)",
  "Alcohol & tobacco",
  "Weapons",
  "Gambling",
];

export const ALL_CATEGORIES = [...NORMAL_CATEGORIES, ...RESTRICTED_CATEGORIES];