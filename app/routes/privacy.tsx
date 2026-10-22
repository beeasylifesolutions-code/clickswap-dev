export const meta = () => [{ title: "Privacy Policy - PostSwap" }];

export default function Privacy() {
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
      <h1>PostSwap Privacy Policy</h1>
      <p>Last updated: October 21, 2026</p>

      <p>
        PostSwap is a Shopify app that shows a store&apos;s own products, and
        optionally products from partner stores, on the Thank You page and the
        Order Confirmation page. This policy explains what PostSwap stores and
        why. PostSwap collects no personal customer data.
      </p>

      <h2 style={h2}>What we store about merchants</h2>
      <ul>
        <li>
          Your store&apos;s Shopify domain, your chosen store category, your
          plan, your settings and your credit balance.
        </li>
        <li>
          The products you choose to promote: product title, image, price,
          link, and any discount code you enter.
        </li>
        <li>
          The name and email of the staff member who signs in to PostSwap.
          Shopify provides these when the staff member opens the app, and they
          are kept in our session table while the app is installed.
        </li>
        <li>
          A count of your paid orders in the last 30 days. We request the
          read_orders permission only to count paid orders. We do not store
          order contents, customer names, emails, addresses or payment
          details.
        </li>
        <li>
          Records of ads shown and clicked: which ad was shown, when, and a
          random one-time token. These records are not linked to any shopper
          identity.
        </li>
      </ul>

      <h2 style={h2}>What we store about your customers</h2>
      <p>
        We do not collect shoppers&apos; names, emails, phone numbers,
        addresses or payment information. To avoid counting the same order
        twice, we keep a one-way hashed reference to the order. It cannot be
        turned back into the real order number.
      </p>
      <p>
        If you switch on the optional customer survey, shoppers can tap an
        answer to a multiple-choice question. Answers are anonymous. There is
        no free-text box, and each answer is linked only to the hashed order
        reference. The same applies to scratch ticket and surprise gift
        results: we record which prize was shown for a hashed order reference.
      </p>

      <h2 style={h2}>Server logs</h2>
      <p>
        Our hosting provider (Render) keeps standard server logs for a short
        time. These logs can include the IP address of a device that loads an
        ad. We do not use these logs to identify or track shoppers.
      </p>

      <h2 style={h2}>How we use information</h2>
      <ul>
        <li>To show ads and your own products on your Thank You and Order Confirmation pages.</li>
        <li>To count verified clicks and keep the credit balance between stores.</li>
        <li>To show you your dashboard and statistics.</li>
        <li>To prevent fraud, abuse and prohibited ads.</li>
      </ul>

      <h2 style={h2}>What other stores see</h2>
      <p>
        If you turn on the partner swap, partner stores&apos; shoppers can see
        the product title, image, price, link and discount code you chose to
        promote. A shopper who clicks a partner ad goes to the advertiser&apos;s
        store. We do not send any shopper information to partner stores.
      </p>

      <h2 style={h2}>Services we rely on</h2>
      <ul>
        <li>Shopify, for the app platform, sign-in and billing.</li>
        <li>Render, for hosting the app.</li>
        <li>Supabase, for the database.</li>
      </ul>
      <p>We do not sell personal information.</p>

      <h2 style={h2}>How long we keep data</h2>
      <p>
        When you uninstall PostSwap, your ads are paused and your login
        sessions are deleted right away. About 48 hours later, Shopify sends
        us a store-deletion notice and we delete everything we hold for your
        store. Ad-view records that were never clicked are removed
        automatically after 90 days.
      </p>

      <h2 style={h2}>Your rights</h2>
      <p>
        You can ask us to show you, correct or delete the information we hold
        about your store or staff account. Depending on where you live, you may
        have more rights, such as under privacy laws in Canada or the European
        Union. Email us at the address below and we will respond.
      </p>

      <h2 style={h2}>Changes to this policy</h2>
      <p>
        If we change this policy, we will update the date at the top of this
        page.
      </p>

      <h2 style={h2}>Contact</h2>
      <p>
        Questions or requests:{" "}
        <a href="mailto:beeasylifesolutions@gmail.com">
          beeasylifesolutions@gmail.com
        </a>
      </p>
    </main>
  );
}