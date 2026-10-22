import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { randomInt } from "node:crypto";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

const MAX_MEMBERS = 25;
const MAX_CIRCLES = 3;
// No 0/O or 1/I so codes are easy to read and type
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode() {
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });
  const memberships = await prisma.circleMember.findMany({
    where: { shopId: shop.id },
    include: {
      circle: {
        include: {
          members: { include: { shop: { select: { domain: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  const circles = memberships.map((row) => {
    const isOwner = row.circle.ownerShopId === shop.id;
    return {
      id: row.circle.id,
      name: row.circle.name,
      isOwner,
      // Only the owner sees the invite code
      code: isOwner ? row.circle.code : null,
      members: row.circle.members.map((member) => ({
        shopId: member.shopId,
        domain: member.shop.domain,
        isOwner: member.shopId === row.circle.ownerShopId,
        isMe: member.shopId === shop.id,
      })),
    };
  });
  return {
    circles,
    circleOnly: shop.circleOnly,
    maxMembers: MAX_MEMBERS,
    maxCircles: MAX_CIRCLES,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const shop = await prisma.shop.findUnique({
    where: { domain: session.shop },
  });
  if (!shop) return { ok: false, message: "Shop not found." };
  const intent = String(form.get("intent") || "");

  if (intent === "setCircleOnly") {
    const value = String(form.get("value")) === "true";
    await prisma.shop.update({
      where: { id: shop.id },
      data: { circleOnly: value },
    });
    return {
      ok: true,
      message: value ? "Circle-only is on" : "Circle-only is off",
    };
  }

  const myCount = await prisma.circleMember.count({
    where: { shopId: shop.id },
  });

  if (intent === "create") {
    const name = String(form.get("name") || "").trim().slice(0, 40);
    if (!name) return { ok: false, message: "Give your Circle a name." };
    if (myCount >= MAX_CIRCLES) {
      return {
        ok: false,
        message: `A store can be in up to ${MAX_CIRCLES} Circles.`,
      };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await prisma.circle.create({
          data: {
            name,
            code: makeCode(),
            ownerShopId: shop.id,
            members: { create: { shopId: shop.id } },
          },
        });
        return { ok: true, message: "Circle created" };
      } catch (error) {
        // Code already used: try another one
      }
    }
    return { ok: false, message: "Could not create the Circle. Try again." };
  }

  if (intent === "join") {
    const code = String(form.get("code") || "")
      .trim()
      .toUpperCase();
    if (!code) return { ok: false, message: "Enter an invite code." };
    const circle = await prisma.circle.findUnique({
      where: { code },
      include: { members: { select: { shopId: true } } },
    });
    if (!circle) return { ok: false, message: "That code was not found." };
    if (circle.members.some((member) => member.shopId === shop.id)) {
      return { ok: false, message: "You are already in that Circle." };
    }
    if (circle.members.length >= MAX_MEMBERS) {
      return { ok: false, message: "That Circle is full." };
    }
    if (myCount >= MAX_CIRCLES) {
      return {
        ok: false,
        message: `A store can be in up to ${MAX_CIRCLES} Circles.`,
      };
    }
    await prisma.circleMember.create({
      data: { circleId: circle.id, shopId: shop.id },
    });
    return { ok: true, message: `Joined ${circle.name}` };
  }

  const circleId = String(form.get("circleId") || "");
  const circle = await prisma.circle.findUnique({ where: { id: circleId } });
  if (!circle) return { ok: false, message: "That Circle no longer exists." };

  if (intent === "leave") {
    if (circle.ownerShopId === shop.id) {
      return {
        ok: false,
        message: "The owner cannot leave. Delete the Circle instead.",
      };
    }
    await prisma.circleMember.deleteMany({
      where: { circleId, shopId: shop.id },
    });
    return { ok: true, message: "You left the Circle" };
  }

  // Everything below is owner-only
  if (circle.ownerShopId !== shop.id) {
    return { ok: false, message: "Only the Circle owner can do that." };
  }

  if (intent === "delete") {
    await prisma.circle.delete({ where: { id: circleId } });
    return { ok: true, message: "Circle deleted" };
  }

  if (intent === "remove") {
    const memberShopId = String(form.get("memberShopId") || "");
    if (memberShopId === shop.id) {
      return { ok: false, message: "You cannot remove yourself." };
    }
    await prisma.circleMember.deleteMany({
      where: { circleId, shopId: memberShopId },
    });
    return { ok: true, message: "Store removed" };
  }

  return { ok: false, message: "Unknown action." };
};

export default function CirclesPage() {
  const { circles, circleOnly, maxMembers, maxCircles } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const busy = fetcher.state !== "idle";
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [onlyCircle, setOnlyCircle] = useState(circleOnly);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.ok) {
      shopify.toast.show(fetcher.data.message);
      setName("");
      setCode("");
    } else {
      shopify.toast.show(fetcher.data.message, { isError: true });
    }
  }, [fetcher.data, shopify]);

  const submit = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.append(key, value);
    fetcher.submit(data, { method: "post" });
  };

  const hasPartners = circles.some((circle) => circle.members.length > 1);

  return (
    <s-page heading="Circles">
      <s-stack direction="block" gap="large">
        <s-section heading="What is a Circle?">
          <s-stack direction="block" gap="small">
            <s-text>
              A Circle is a private group of up to {maxMembers} stores that
              you trust. Turn on Circle-only below and your Thank You page
              shows ads only from the stores in your Circles. A store can be in
              up to {maxCircles} Circles.
            </s-text>
            <s-text>
              Members of a Circle can see each other&apos;s store address.
              Credits, daily limits and safety rules work as usual.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Only show ads from my Circles">
          <s-stack direction="block" gap="small">
            <s-switch
              label="Only show ads from stores in my Circles"
              checked={onlyCircle}
              onChange={(event: Event) => {
                const next = (event.currentTarget as HTMLInputElement).checked;
                setOnlyCircle(next);
                submit({ intent: "setCircleOnly", value: String(next) });
              }}
            />
            {onlyCircle && !hasPartners ? (
              <s-banner tone="warning">
                You have no Circle partners yet, so no partner ads will show.
                Your own products will fill the slots until someone joins a
                Circle with you.
              </s-banner>
            ) : null}
            <s-text>
              When this is on, no new stores appear on your page. Stores you
              blocked or hid by category stay hidden.
            </s-text>
          </s-stack>
        </s-section>

        <s-section heading="Create a Circle">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Circle name"
              value={name}
              onInput={(event: Event) =>
                setName((event.currentTarget as HTMLInputElement).value)
              }
            />
            <s-button
              disabled={busy}
              onClick={() => submit({ intent: "create", name })}
            >
              Create Circle
            </s-button>
          </s-stack>
        </s-section>

        <s-section heading="Join a Circle">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Invite code"
              value={code}
              onInput={(event: Event) =>
                setCode((event.currentTarget as HTMLInputElement).value)
              }
            />
            <s-button
              disabled={busy}
              onClick={() => submit({ intent: "join", code })}
            >
              Join Circle
            </s-button>
          </s-stack>
        </s-section>

        <s-section heading={`Your Circles (${circles.length} of ${maxCircles})`}>
          <s-stack direction="block" gap="base">
            {circles.length === 0 ? (
              <s-text>You are not in a Circle yet.</s-text>
            ) : (
              circles.map((circle) => (
                <s-box
                  key={circle.id}
                  border="base"
                  borderRadius="base"
                  padding="base"
                >
                  <s-stack direction="block" gap="small">
                    <s-stack direction="inline" gap="base">
                      <s-heading>{circle.name}</s-heading>
                      {circle.isOwner ? <s-badge>Owner</s-badge> : null}
                    </s-stack>
                    {circle.code ? (
                      <s-text>
                        Invite code: <s-text type="strong">{circle.code}</s-text>{" "}
                        (share it only with stores you trust)
                      </s-text>
                    ) : null}
                    <s-text>
                      {circle.members.length} of {maxMembers} stores
                    </s-text>
                    {circle.members.map((member) => (
                      <s-stack
                        key={member.shopId}
                        direction="inline"
                        gap="base"
                      >
                        <s-text>
                          {member.domain}
                          {member.isMe ? " (you)" : ""}
                          {member.isOwner ? " - owner" : ""}
                        </s-text>
                        {circle.isOwner && !member.isMe ? (
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            disabled={busy}
                            onClick={() =>
                              submit({
                                intent: "remove",
                                circleId: circle.id,
                                memberShopId: member.shopId,
                              })
                            }
                          >
                            Remove
                          </s-button>
                        ) : null}
                      </s-stack>
                    ))}
                    {circle.isOwner ? (
                      <s-button
                        tone="critical"
                        disabled={busy}
                        onClick={() =>
                          submit({ intent: "delete", circleId: circle.id })
                        }
                      >
                        Delete Circle
                      </s-button>
                    ) : (
                      <s-button
                        disabled={busy}
                        onClick={() =>
                          submit({ intent: "leave", circleId: circle.id })
                        }
                      >
                        Leave Circle
                      </s-button>
                    )}
                  </s-stack>
                </s-box>
              ))
            )}
          </s-stack>
        </s-section>
      </s-stack>
    </s-page>
  );
}