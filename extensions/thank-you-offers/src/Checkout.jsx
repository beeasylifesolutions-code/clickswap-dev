import '@shopify/ui-extensions/preact';
import {render} from "preact";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  return (
    <s-banner heading="A thank-you gift for you">
      <s-stack gap="base">
        <s-text>Use code THANKYOU10 for 10% off your next order.</s-text>
        <s-text type="emphasis">Sample offer</s-text>
      </s-stack>
    </s-banner>
  );
}