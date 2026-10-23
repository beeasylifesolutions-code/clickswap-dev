export type HelpTopic = {
  path: string;
  title: string;
  summary: string;
  points: string[];
};

export const SETUP_STEPS = [
  {
    title: "Fill your slots",
    text: "On the Home page, click Set up for me. It picks your top products and fills your 6 slots: 3 on the Order Confirmation page and 3 on the Thank You page. You can change any slot on the Slots page.",
  },
  {
    title: "Add the two blocks",
    text: "Shopify only lets you place these yourself. In Settings, then Checkout, then Customize: open the Thank you page and add the thank-you-offers block, then open the Order status page and add the order-status-offers block. Save each page.",
  },
  {
    title: "Turn on swap (optional)",
    text: "Swap shows other stores' products on your Thank You page, and yours on theirs. It needs your agreement, a store category, and at least 50 paid orders in the last 30 days. Without swap, your own products still fill every slot.",
  },
];

export const PAGE_HELP: HelpTopic[] = [
  {
    path: "/app",
    title: "Home",
    summary: "The three setup steps and your backup offers.",
    points: [
      "Step 1 fills your slots with your best products in one click.",
      "Step 2 is the one step Shopify makes you do yourself: add the two blocks in the checkout editor.",
      "Step 3 turns on the swap with other stores. It is optional.",
      "The main switch turns PostSwap off or on for your Thank You page.",
      "Backup text offers only show if there is nothing else to show. Most stores can leave them alone.",
    ],
  },
  {
    path: "/app/slots",
    title: "Slots",
    summary: "The 6 places your products appear.",
    points: [
      "Order Confirmation page: 3 slots that always show your own products.",
      "Thank You page: 3 slots that show a partner product first when one is available, and your own product otherwise.",
      "Click Choose product to pick what a slot shows. Your products on the Thank You page also become your ads on partner stores.",
      "Test a second product runs an A/B test: shoppers are split 50/50 and results appear on the Dashboard.",
      "Each Thank You slot can be set to your product only, or locked to one of your pinned partner stores.",
    ],
  },
  {
    path: "/app/rewards",
    title: "Scratch tickets and surprise gifts",
    summary: "A small prize game on your Thank You page.",
    points: [
      "First make a discount code for each prize in Shopify, under Discounts.",
      "Create a reward here, then add each prize with its code and a chance from 1 to 100.",
      "Every shopper wins one prize per order. Include a small prize so every ticket wins something.",
      "A reward only turns on once it has at least one prize.",
    ],
  },
  {
    path: "/app/survey",
    title: "Customer survey",
    summary: "One tap-to-answer question on your Thank You page.",
    points: [
      "Pick a ready-made question or write your own, with 2 or more answers, one per line.",
      "Answers are anonymous: shoppers only tap a choice, and no names or emails are collected.",
      "Each order can answer once. Results appear at the bottom of this page.",
    ],
  },
  {
    path: "/app/dashboard",
    title: "Dashboard",
    summary: "Your numbers for the last 7, 30 or 90 days.",
    points: [
      "Credit balance is what you have earned minus what you have spent.",
      "Clicks wait 24 hours before they count as credits. The waiting amounts are shown under the tiles.",
      "Today's limits show how many partner-ad page views and clicks your plan allows each day. They reset at midnight UTC.",
      "Your own products shows views and clicks for each product, and A/B tests show which product is ahead.",
      "Milestones are all-time badges. Once earned, they stay.",
    ],
  },
  {
    path: "/app/swap",
    title: "Swap ads",
    summary: "Turn on the swap and see your ads.",
    points: [
      "You earn 1 credit when a shopper clicks another store's product on your Thank You page. You spend 1 credit when a shopper clicks your product on another store's page.",
      "Every store starts at zero credits, so partner ads start showing once you have earned your first credit.",
      "You must choose your store's category, tick the agreement box, and have 50 paid orders in the last 30 days.",
      "Development (test) stores skip the order minimum and see one clearly labeled sample partner ad instead of real ones.",
      "Your ads come from the products in your Thank You slots.",
    ],
  },
  {
    path: "/app/partners",
    title: "Partner stores",
    summary: "Choose who shows on your Thank You page.",
    points: [
      "This list shows the stores whose products appeared on your Thank You page in the last 30 days.",
      "Pin a store to see it first. You can pin up to 10.",
      "Block a store to never see it again. A blocked store's ads never show on your pages, and yours never show on theirs.",
      "Only show ads from my chosen partners limits your page to the stores you pinned.",
    ],
  },
  {
    path: "/app/circles",
    title: "Circles",
    summary: "Private groups of stores you trust.",
    points: [
      "A Circle holds up to 25 stores. A store can be in up to 3 Circles.",
      "Create a Circle and share its invite code only with stores you trust. Members can see each other's store address.",
      "Turn on Circle-only to show ads only from the stores in your Circles.",
      "Credits, daily limits and safety rules work as usual.",
    ],
  },
  {
    path: "/app/safety",
    title: "Safety",
    summary: "Your controls over what shows on your pages.",
    points: [
      "The kill switch turns everything off at once. Nothing is uninstalled.",
      "Network swap can be paused at any time. Your pages then show only your own offers.",
      "Adult and restricted stores (adult 18+, alcohol, tobacco, weapons, gambling) are hidden unless you choose to show them.",
      "Tick categories to never see ads from those kinds of stores. You can also block single stores by address.",
      "Choose your own store's category honestly. Choosing a different one to avoid the filter breaks the PostSwap rules.",
    ],
  },
];

export const FAQ = [
  {
    q: "Why do I only see my own products on my Thank You page?",
    a: "Partner ads show only when swap is on, you have earned your first credit, a partner ad is available that passes your safety settings, and you are inside your daily limits. Whenever one of those is missing, your own product fills the slot, so a slot is never empty.",
  },
  {
    q: "How do credits work?",
    a: "You earn 1 credit for each verified click on a partner's product on your Thank You page, and you spend 1 credit for each verified click on your product on another store's page. A click counts as a credit after a 24-hour hold.",
  },
  {
    q: "Does PostSwap collect my customers' personal data?",
    a: "No. PostSwap collects no personal customer data. Survey answers are anonymous taps, and clicks are counted without names, emails or addresses.",
  },
  {
    q: "What if something goes wrong with PostSwap?",
    a: "Your checkout keeps working. If PostSwap cannot be reached, the PostSwap blocks stay empty and the rest of the page loads normally.",
  },
  {
    q: "How do I stop everything quickly?",
    a: "Open the Safety page and turn on the kill switch. Nothing from PostSwap then shows on your pages. You can turn it back on at any time.",
  },
  {
    q: "What happens when I uninstall?",
    a: "Your ads stop showing right away. Shopify then asks PostSwap to delete your store's data, and it is removed.",
  },
];

export const SUPPORT_EMAIL = "beeasylifesolutions@gmail.com";