import { FAQ, PAGE_HELP, SETUP_STEPS, SUPPORT_EMAIL } from "../help";

export const meta = () => [{ title: "Help - PostSwap" }];

export default function PublicHelp() {
  return (
    <main
      style={{
        maxWidth: 760,
        margin: "0 auto",
        padding: "48px 20px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        lineHeight: 1.6,
        color: "#1a1a1a",
      }}
    >
      <h1>PostSwap help</h1>
      <p>
        PostSwap fills the space on your Thank You and Order Confirmation pages
        with products. Your own products always fill the slots. If you turn on
        the swap, products from other stores, marked Sponsored, can also appear
        on your Thank You page, and yours on theirs. You earn credits when
        shoppers click other stores&apos; products, and spend credits when
        shoppers click yours.
      </p>

      <h2>Get set up in 3 steps</h2>
      <ol>
        {SETUP_STEPS.map((step) => (
          <li key={step.title}>
            <strong>{step.title}.</strong> {step.text}
          </li>
        ))}
      </ol>

      <h2>Every page, explained</h2>
      {PAGE_HELP.map((topic) => (
        <section key={topic.path}>
          <h3>{topic.title}</h3>
          <p>{topic.summary}</p>
          <ul>
            {topic.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>
      ))}

      <h2>Common questions</h2>
      {FAQ.map((item) => (
        <section key={item.q}>
          <h3>{item.q}</h3>
          <p>{item.a}</p>
        </section>
      ))}

      <h2>Need a hand?</h2>
      <p>
        Email {SUPPORT_EMAIL}. Please include your store address and what you
        were doing.
      </p>
    </main>
  );
}