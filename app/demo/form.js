"use client";

import { useFormStatus } from "react-dom";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
    >
      {pending ? "Saving…" : "Add note"}
    </button>
  );
}

export function DemoForm({ action }) {
  return (
    <form action={action} className="space-y-3">
      <label htmlFor="body" className="block text-sm font-medium">
        New note
      </label>
      <input
        id="body"
        name="body"
        type="text"
        required
        maxLength={500}
        placeholder="e.g. Customer #3 hates our onboarding flow"
        className="w-full rounded-md border border-gray-500/20 bg-transparent px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />
      <SubmitButton />
    </form>
  );
}
