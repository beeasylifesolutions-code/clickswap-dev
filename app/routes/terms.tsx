export const meta = () => [{ title: "Terms of Service - PostSwap" }];

export default function Terms() {
  const page: React.CSSProperties = {
    maxWidth: 760,
    margin: "0 auto",
    padding: "32px 20px 64px",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    lineHeight: 1.6,
    color: "#1a1a1a",
  };
  const h2: React.CSSProperties = { marginTop: 32 };

  return (
    <main style={page}>
      <h1>PostSwap Terms of Service</h1>
      <p>Last updated: October 21, 2026</p>

      <p>
        These terms apply when you install and use PostSwap, a Shopify app that
        shows your own products and, if you choose, partner stores&apos;
        products on your Thank You and Order Confirmation pages. By installing
        PostSwap you agree to these terms.
      </p>

      <h2 style={h2}>What PostSwap does</h2>
      <p>
        PostSwap lets you promote your own products to your customers after
        they order. If you turn on the partner swap, it also shows ads from
        other participating stores, and shows your ads on theirs. Each verified
        click on a partner ad moves one credit from the advertiser to the store
        that showed the ad. Credits have no cash value and cannot be bought,
        sold or withdrawn.
      </p>

      <h2 style={h2}>Your responsibilities</h2>
      <ul>
        <li>You must have the right to promote the products and any discount codes you enter.</li>
        <li>Your product titles, images, prices and links must be accurate and not misleading.</li>
        <li>You must follow Shopify&apos;s terms and all laws that apply to your business.</li>
        <li>
          You must not click your own ads, ask others to click them, or use
          bots, scripts or any other method to create fake clicks or views.
        </li>
      </ul>

      <h2 style={h2}>Prohibited products and content</h2>
      <p>You may not promote any of the following through the partner swap:</p>
      <ul>
        <li>Adult or sexually explicit products or content</li>
        <li>Alcohol</li>
        <li>Tobacco, vaping or nicotine products</li>
        <li>Weapons, firearms or ammunition</li>
        <li>Gambling</li>
        <li>Illegal products or services</li>
        <li>Products or content that is hateful, deceptive, harmful or infringes someone else&apos;s rights</li>
      </ul>
      <p>
        You must choose the correct store category when you turn on the swap.
        Stores in restricted categories are hidden from other stores by default.
        Choosing a wrong category to avoid this is a breach of these terms.
      </p>

      <h2 style={h2}>Reports, removal and suspension</h2>
      <p>
        Merchants can report ads. We may review reports and remove any ad,
        switch off a store&apos;s swap, or suspend a store at any time if we
        believe it breaks these terms, harms other stores or shoppers, or
        shows suspicious click activity. Credits from clicks we find to be
        invalid may be cancelled.
      </p>

      <h2 style={h2}>Limits</h2>
      <p>
        Each plan has limits, such as the number of paid orders it covers and
        how many ad views and clicks you can receive each day. We may change
        how the swap network works to keep it fair and to prevent abuse.
      </p>

      <h2 style={h2}>Plans and billing</h2>
      <p>
        Paid plans are billed through Shopify. Prices, trial length and plan
        limits are shown when you choose a plan. You can cancel at any time by
        uninstalling the app.
      </p>

      <h2 style={h2}>No guarantee of results</h2>
      <p>
        PostSwap is provided as is. We do not promise any number of views,
        clicks or sales, and we are not responsible for what partner stores
        sell or how they treat customers. To the extent the law allows, our
        liability to you is limited to the amount you paid for PostSwap in the
        three months before the problem arose.
      </p>

      <h2 style={h2}>Ending your use</h2>
      <p>
        You can uninstall PostSwap at any time. We may end your access if you
        break these terms. Your data is deleted as described in our{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2 style={h2}>Changes</h2>
      <p>
        We may update these terms. If we do, we will change the date at the top
        of this page, and continuing to use PostSwap means you accept the
        update.
      </p>

      <h2 style={h2}>Contact</h2>
      <p>
        Questions:{" "}
        <a href="mailto:beeasylifesolutions@gmail.com">
          beeasylifesolutions@gmail.com
        </a>
      </p>
    </main>
  );
}