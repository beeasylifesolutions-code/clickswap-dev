import { FAQ, PAGE_HELP, SETUP_STEPS, SUPPORT_EMAIL } from "../help";

export default function HelpPage() {
  return (
    <s-page heading="Help">
      <s-stack direction="block" gap="base">
        <s-section heading="What PostSwap does">
          <s-text>
            PostSwap fills the space on your Thank You and Order Confirmation
            pages with products. Your own products always fill the slots. If you
            turn on the swap, products from other stores, marked Sponsored, can
            also appear on your Thank You page, and yours on theirs. You earn
            credits when shoppers click other stores' products, and spend
            credits when shoppers click yours.
          </s-text>
        </s-section>

        <s-section heading="Get set up in 3 steps">
          <s-stack direction="block" gap="base">
            {SETUP_STEPS.map((step, index) => (
              <s-stack key={step.title} direction="block" gap="small">
                <s-heading>
                  {index + 1}. {step.title}
                </s-heading>
                <s-text>{step.text}</s-text>
              </s-stack>
            ))}
            <s-link
              href="shopify:admin/settings/checkout/editor"
              target="_blank"
            >
              Open the checkout editor
            </s-link>
          </s-stack>
        </s-section>

        <s-section heading="Every page, explained">
          <s-stack direction="block" gap="base">
            {PAGE_HELP.map((topic) => (
              <s-box
                key={topic.path}
                border="base"
                borderRadius="base"
                padding="base"
              >
                <s-stack direction="block" gap="small">
                  <s-heading>{topic.title}</s-heading>
                  <s-text>{topic.summary}</s-text>
                  {topic.points.map((point) => (
                    <s-text key={point}>- {point}</s-text>
                  ))}
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-section>

        <s-section heading="Common questions">
          <s-stack direction="block" gap="base">
            {FAQ.map((item) => (
              <s-stack key={item.q} direction="block" gap="small">
                <s-text type="strong">{item.q}</s-text>
                <s-text>{item.a}</s-text>
              </s-stack>
            ))}
          </s-stack>
        </s-section>

        <s-section heading="Need a hand?">
          <s-text>
            Email {SUPPORT_EMAIL}. Please include your store address and what
            you were doing.
          </s-text>
        </s-section>
      </s-stack>
    </s-page>
  );
}