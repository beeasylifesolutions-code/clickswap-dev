import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect, Form, useActionData, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const errors = loginErrorMessage(await login(request));

  return { errors };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const errors = actionData?.errors;

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Thank You page offers and traffic swap</h1>
        <p className={styles.text}>
          Turn your order confirmation page into a second chance to sell, and
          swap traffic with other Shopify stores.
        </p>
        {showForm && (
          <Form className={styles.form} method="post">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>{errors?.shop ?? "e.g: my-shop-domain.myshopify.com"}</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Your own offers</strong>. Show up to three offers on your
            Thank You page, with discount codes and start and end dates.
          </li>
          <li>
            <strong>Traffic swap</strong>. Opt in to show other stores' offers,
            clearly labeled Sponsored, and earn credits that bring visitors to
            your store.
          </li>
          <li>
            <strong>Simple dashboard</strong>. See your clicks sent, clicks
            received and credit balance at a glance.
          </li>
        </ul>
      </div>
    </div>
  );
}