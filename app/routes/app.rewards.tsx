import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const MAX_REWARDS = 3;
const MAX_PRIZES = 6;
const DEFAULT_TITLE: Record<string, string> = {
  scratch: "Scratch & win",
  gift: "Surprise gift",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });
  const rewards = await prisma.reward.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "asc" },
    include: { prizes: { orderBy: { createdAt: "asc" } } },
  });
  return {
    rewards: rewards.map((reward) => ({
      id: reward.id,
      kind: reward.kind,
      title: reward.title,
      active: reward.active,
      prizes: reward.prizes.map((prize) => ({
        id: prize.id,
        label: prize.label,
        code: prize.code ?? "",
        weight: prize.weight,
      })),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  if (intent === "createReward") {
    const kind = String(form.get("kind") || "");
    if (kind !== "scratch" && kind !== "gift") {
      return { ok: false, error: "Choose scratch ticket or surprise gift.", message: "" };
    }
    const count = await prisma.reward.count({ where: { shopId: shop.id } });
    if (count >= MAX_REWARDS) {
      return {
        ok: false,
        error: `You can have up to ${MAX_REWARDS} rewards. Delete one first.`,
        message: "",
      };
    }
    const title =
      String(form.get("title") || "").trim().slice(0, 60) || DEFAULT_TITLE[kind];
    await prisma.reward.create({
      data: { shopId: shop.id, kind, title, active: false },
    });
    return { ok: true, error: "", message: "Reward created. Add prizes next." };
  }

  const rewardId = String(form.get("rewardId") || "");
  const reward = await prisma.reward.findFirst({
    where: { id: rewardId, shopId: shop.id },
    include: { prizes: true },
  });
  if (!reward) {
    return { ok: false, error: "Reward not found.", message: "" };
  }

  if (intent === "addPrize") {
    const label = String(form.get("label") || "").trim().slice(0, 80);
    const code = String(form.get("code") || "").trim().slice(0, 60);
    const weight = Math.round(Number(form.get("weight") || 1));
    if (!label) {
      return { ok: false, error: "Write what the shopper wins, for example 10% off.", message: "" };
    }
    if (!code) {
      return {
        ok: false,
        error: "Enter the discount code you made in Shopify for this prize.",
        message: "",
      };
    }
    if (!(weight >= 1 && weight <= 100)) {
      return { ok: false, error: "Chance must be a number from 1 to 100.", message: "" };
    }
    if (reward.prizes.length >= MAX_PRIZES) {
      return { ok: false, error: `Up to ${MAX_PRIZES} prizes per reward.`, message: "" };
    }
    await prisma.rewardPrize.create({
      data: { rewardId: reward.id, label, code, weight },
    });
    return { ok: true, error: "", message: "Prize added" };
  }

  if (intent === "deletePrize") {
    const prizeId = String(form.get("prizeId") || "");
    await prisma.rewardPrize.deleteMany({
      where: { id: prizeId, rewardId: reward.id },
    });
    return { ok: true, error: "", message: "Prize removed" };
  }

  if (intent === "toggleReward") {
    if (!reward.active && reward.prizes.length === 0) {
      return {
        ok: false,
        error: "Add at least one prize before turning this on.",
        message: "",
      };
    }
    await prisma.reward.update({
      where: { id: reward.id },
      data: { active: !reward.active },
    });
    return {
      ok: true,
      error: "",
      message: reward.active ? "Reward turned off" : "Reward turned on",
    };
  }

  if (intent === "deleteReward") {
    await prisma.reward.delete({ where: { id: reward.id } });
    return { ok: true, error: "", message: "Reward deleted" };
  }

  return { ok: false, error: "Unknown action.", message: "" };
};

const valueOf = (event: any) => String(event.currentTarget?.value ?? "");

type RewardData = {
  id: string;
  kind: string;
  title: string;
  active: boolean;
  prizes: { id: string; label: string; code: string; weight: number }[];
};

function RewardCard({ reward }: { reward: RewardData }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [weight, setWeight] = useState("10");

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
      if (fetcher.data.message === "Prize added") {
        setLabel("");
        setCode("");
      }
    }
  }, [fetcher.data, shopify]);

  const send = (data: Record<string, string>) =>
    fetcher.submit({ rewardId: reward.id, ...data }, { method: "post" });

  const totalWeight = reward.prizes.reduce((sum, p) => sum + p.weight, 0);

  return (
    <s-section
      heading={`${reward.kind === "scratch" ? "Scratch ticket" : "Surprise gift"}: ${reward.title}`}
    >
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="base">
          <s-badge tone={reward.active ? "success" : "neutral"}>
            {reward.active ? "On" : "Off"}
          </s-badge>
          <s-button onClick={() => send({ intent: "toggleReward" })}>
            {reward.active ? "Turn off" : "Turn on"}
          </s-button>
          <s-button
            tone="critical"
            onClick={() => send({ intent: "deleteReward" })}
          >
            Delete reward
          </s-button>
        </s-stack>

        {reward.prizes.length === 0 ? (
          <s-text>No prizes yet. Add your first prize below.</s-text>
        ) : (
          reward.prizes.map((prize) => (
            <s-box
              key={prize.id}
              border="base"
              borderRadius="base"
              padding="base"
            >
              <s-stack direction="inline" gap="base">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">{prize.label}</s-text>
                  <s-text>
                    Code: {prize.code} | Chance:{" "}
                    {totalWeight > 0
                      ? Math.round((prize.weight / totalWeight) * 100)
                      : 0}
                    %
                  </s-text>
                </s-stack>
                <s-button
                  variant="tertiary"
                  onClick={() =>
                    send({ intent: "deletePrize", prizeId: prize.id })
                  }
                >
                  Remove
                </s-button>
              </s-stack>
            </s-box>
          ))
        )}

        {reward.prizes.length < MAX_PRIZES ? (
          <s-stack direction="block" gap="base">
            <s-text type="strong">Add a prize</s-text>
            <s-text-field
              label="What the shopper wins (example: 10% off your next order)"
              value={label}
              onInput={(event: any) => setLabel(valueOf(event))}
            />
            <s-text-field
              label="Discount code (you make this in Shopify under Discounts)"
              value={code}
              onInput={(event: any) => setCode(valueOf(event))}
            />
            <s-text-field
              label="Chance (1 to 100, bigger wins more often)"
              value={weight}
              onInput={(event: any) => setWeight(valueOf(event))}
            />
            {fetcher.data && !fetcher.data.ok ? (
              <s-banner tone="critical">{fetcher.data.error}</s-banner>
            ) : null}
            <s-button
              variant="primary"
              onClick={() => send({ intent: "addPrize", label, code, weight })}
            >
              Add prize
            </s-button>
          </s-stack>
        ) : null}
      </s-stack>
    </s-section>
  );
}

export default function RewardsPage() {
  const { rewards } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const [kind, setKind] = useState("scratch");
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
      setTitle("");
    }
  }, [fetcher.data, shopify]);

  return (
    <s-page heading="Scratch tickets and surprise gifts">
      <s-stack direction="block" gap="base">
        <s-section heading="How it works">
          <s-stack direction="block" gap="small">
            <s-text>
              1. In Shopify, go to Discounts and make a discount code for each
              prize.
            </s-text>
            <s-text>
              2. Create a reward here and add each prize with its code.
            </s-text>
            <s-text>
              3. Every shopper wins one prize, picked at random using your
              chances. Include a small prize so every ticket wins something.
            </s-text>
            <s-text>
              The prize is picked once per order, so reloading the page shows
              the same prize.
            </s-text>
          </s-stack>
        </s-section>

        {rewards.map((reward) => (
          <RewardCard key={reward.id} reward={reward} />
        ))}

        <s-section heading="Create a new reward">
          <s-stack direction="block" gap="base">
            <s-select
              label="Type"
              value={kind}
              onChange={(event: any) => setKind(valueOf(event))}
            >
              <s-option value="scratch">Scratch ticket</s-option>
              <s-option value="gift">Surprise gift</s-option>
            </s-select>
            <s-text-field
              label="Title shoppers see (optional)"
              value={title}
              onInput={(event: any) => setTitle(valueOf(event))}
            />
            {fetcher.data && !fetcher.data.ok ? (
              <s-banner tone="critical">{fetcher.data.error}</s-banner>
            ) : null}
            <s-button
              variant="primary"
              onClick={() =>
                fetcher.submit(
                  { intent: "createReward", kind, title },
                  { method: "post" },
                )
              }
            >
              Create reward
            </s-button>
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}