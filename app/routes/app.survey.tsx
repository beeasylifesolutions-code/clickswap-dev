import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  DEFAULT_PRESET,
  MAX_SURVEY_OPTIONS,
  SURVEY_PRESETS,
} from "../surveys";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const survey = await prisma.survey.findUnique({
    where: { shopId: shop.id },
  });

  const byQuestion = new Map<string, { answer: string; count: number }[]>();
  if (survey) {
    const rows = await prisma.surveyAnswer.groupBy({
      by: ["question", "answer"],
      where: { surveyId: survey.id },
      _count: { _all: true },
    });
    for (const row of rows) {
      const list = byQuestion.get(row.question) ?? [];
      list.push({ answer: row.answer, count: row._count._all });
      byQuestion.set(row.question, list);
    }
  }

  const results = [...byQuestion.entries()].map(([question, rows]) => {
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return {
      question,
      total,
      rows: rows
        .sort((a, b) => b.count - a.count)
        .map((row) => ({
          answer: row.answer,
          count: row.count,
          percent: total > 0 ? Math.round((row.count / total) * 100) : 0,
        })),
    };
  });

  return {
    question: survey?.question ?? DEFAULT_PRESET.question,
    options: (survey?.options ?? DEFAULT_PRESET.options).join("\n"),
    active: survey?.active ?? false,
    results,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();

  const shop = await prisma.shop.upsert({
    where: { domain: session.shop },
    update: {},
    create: { domain: session.shop },
  });

  const question = String(form.get("question") || "").trim().slice(0, 120);
  const lines = String(form.get("options") || "")
    .split("\n")
    .map((line) => line.trim().slice(0, 40))
    .filter((line) => line.length > 0);
  const options = [...new Set(lines)];
  const active = form.get("active") === "true";

  if (!question) {
    return { ok: false, error: "Write the question shoppers will see.", message: "" };
  }
  if (options.length < 2) {
    return { ok: false, error: "Add at least 2 answers, one per line.", message: "" };
  }
  if (options.length > MAX_SURVEY_OPTIONS && !options.every((o) => /^\d+$/.test(o))) {
    return {
      ok: false,
      error: `Use at most ${MAX_SURVEY_OPTIONS} answers.`,
      message: "",
    };
  }

  await prisma.survey.upsert({
    where: { shopId: shop.id },
    update: { question, options, active },
    create: { shopId: shop.id, question, options, active },
  });

  return {
    ok: true,
    error: "",
    message: active ? "Survey saved and turned on" : "Survey saved (off)",
  };
};

const valueOf = (event: any) => String(event.currentTarget?.value ?? "");
const checkedOf = (event: any) => Boolean(event.currentTarget?.checked);

export default function SurveyPage() {
  const saved = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [question, setQuestion] = useState(saved.question);
  const [options, setOptions] = useState(saved.options);
  const [active, setActive] = useState(saved.active);
  const [preset, setPreset] = useState("");

  useEffect(() => {
    if (fetcher.data?.ok && fetcher.data.message) {
      shopify.toast.show(fetcher.data.message);
    }
  }, [fetcher.data, shopify]);

  const choosePreset = (id: string) => {
    setPreset(id);
    const found = SURVEY_PRESETS.find((item) => item.id === id);
    if (found) {
      setQuestion(found.question);
      setOptions(found.options.join("\n"));
    }
  };

  return (
    <s-page heading="Customer survey">
      <s-stack direction="block" gap="base">
        <s-section heading="Ask your customers one question">
          <s-stack direction="block" gap="base">
            <s-text>
              When this is on, shoppers see one question on your Thank you page
              and tap an answer. You do not have to change anything: the
              question below is ready to go.
            </s-text>
            <s-text>
              Answers are anonymous. Shoppers only tap a choice, nobody types
              anything, and no names or emails are collected. Each order can
              answer once.
            </s-text>

            <s-select
              label="Start from a ready-made question (optional)"
              value={preset}
              onChange={(event: any) => choosePreset(valueOf(event))}
            >
              <s-option value="">Keep what is below</s-option>
              {SURVEY_PRESETS.map((item) => (
                <s-option key={item.id} value={item.id}>
                  {item.name}
                </s-option>
              ))}
            </s-select>

            <s-text-field
              label="Question shoppers see"
              value={question}
              onInput={(event: any) => setQuestion(valueOf(event))}
            />
            <s-text-area
              label={`Answers, one per line (2 to ${MAX_SURVEY_OPTIONS})`}
              rows={7}
              value={options}
              onInput={(event: any) => setOptions(valueOf(event))}
            />
            <s-switch
              label="Show this survey on my Thank you page"
              checked={active}
              onChange={(event: any) => setActive(checkedOf(event))}
            />
            {fetcher.data && !fetcher.data.ok ? (
              <s-banner tone="critical">{fetcher.data.error}</s-banner>
            ) : null}
            <s-button
              variant="primary"
              onClick={() =>
                fetcher.submit(
                  { question, options, active: String(active) },
                  { method: "post" },
                )
              }
            >
              Save survey
            </s-button>
          </s-stack>
        </s-section>

        <s-section heading="Results">
          {saved.results.length === 0 ? (
            <s-text>No answers yet.</s-text>
          ) : (
            <s-stack direction="block" gap="base">
              {saved.results.map((result) => (
                <s-box
                  key={result.question}
                  border="base"
                  borderRadius="base"
                  padding="base"
                >
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">{result.question}</s-text>
                    <s-text>{result.total} answers</s-text>
                    {result.rows.map((row) => (
                      <s-text key={row.answer}>
                        {row.answer}: {row.count} ({row.percent}%)
                      </s-text>
                    ))}
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-section>
      </s-stack>
    </s-page>
  );
}