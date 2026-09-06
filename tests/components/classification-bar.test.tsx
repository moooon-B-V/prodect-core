// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithIntl as render } from '../helpers/renderWithIntl';
import { ToastProvider } from '@/components/ui/Toast';

/**
 * The INTERNAL-BILLING control's dialog (MOTIR-4568, design Panel 12).
 *
 * ⚠️ THE REASON GATE IS THE SUBJECT, and it is asserted from the side that can
 * fail: the confirm button is `disabled` until a non-blank reason is typed, and
 * clicking it while blank calls NOTHING. A test that only checked the
 * `disabled` attribute would pass on a button that was styled disabled and still
 * wired — which is the exact defect the attribute exists to prevent.
 *
 * This is the COURTESY half of the rule. The enforcement is the audit
 * vocabulary's reason policy, asserted in the service before the transaction
 * opens (`organizationClassification.test.ts`) and translated by the action
 * (`organizationClassificationAction.test.ts`). All three are needed: a
 * client-side check that was the only check would be no check, and a server
 * check with no client gate would let an operator lose their typing to a
 * refusal.
 */

const setInternalBillingAction = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
vi.mock('@/app/(admin)/admin/tenants/[orgId]/actions', () => ({ setInternalBillingAction }));

const { ClassificationBar } =
  await import('@/app/(admin)/admin/tenants/[orgId]/_components/ClassificationBar');

afterEach(() => {
  cleanup();
  setInternalBillingAction.mockClear();
});

function renderBar(internalBilling = false) {
  render(
    <ToastProvider>
      <ClassificationBar orgId="org_1" name="moooon B.V." internalBilling={internalBilling} />
    </ToastProvider>,
  );
}

describe('ClassificationBar', () => {
  it('offers CLASSIFY for an unclassified org and UNCLASSIFY for a classified one', () => {
    renderBar(false);
    expect(screen.getByRole('button', { name: /Classify as internal billing/i })).toBeTruthy();
    cleanup();

    renderBar(true);
    expect(screen.getByRole('button', { name: /Remove internal classification/i })).toBeTruthy();
  });

  it('cannot be submitted with a blank reason — and clicking calls nothing', async () => {
    renderBar(false);
    fireEvent.click(screen.getByRole('button', { name: /Classify as internal billing/i }));

    const confirm = await screen.findByRole('button', { name: /^Classify as internal$/i });
    expect(confirm.hasAttribute('disabled')).toBe(true);

    // ⚠️ THE CLICK IS THE ASSERTION. A button that merely LOOKS disabled and is
    // still wired passes an attribute check and fails here.
    fireEvent.click(confirm);
    expect(setInternalBillingAction).not.toHaveBeenCalled();
  });

  it('a whitespace-only reason is blank — trimmed, not counted', async () => {
    renderBar(false);
    fireEvent.click(screen.getByRole('button', { name: /Classify as internal billing/i }));

    const field = await screen.findByLabelText(/Reason/i);
    fireEvent.change(field, { target: { value: '   \t ' } });

    const confirm = screen.getByRole('button', { name: /^Classify as internal$/i });
    expect(confirm.hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirm);
    expect(setInternalBillingAction).not.toHaveBeenCalled();
  });

  it('submits the TRIMMED reason and the INVERSE of the current state', async () => {
    renderBar(false);
    fireEvent.click(screen.getByRole('button', { name: /Classify as internal billing/i }));

    fireEvent.change(await screen.findByLabelText(/Reason/i), {
      target: { value: '  Dogfood org (MOTIR-4337)  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Classify as internal$/i }));

    await waitFor(() =>
      expect(setInternalBillingAction).toHaveBeenCalledWith(
        'org_1',
        true,
        'Dogfood org (MOTIR-4337)',
      ),
    );
  });

  it('the unclassify direction sends `false`', async () => {
    renderBar(true);
    fireEvent.click(screen.getByRole('button', { name: /Remove internal classification/i }));

    fireEvent.change(await screen.findByLabelText(/Reason/i), {
      target: { value: 'Moved to a paying plan' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Remove classification$/i }));

    await waitFor(() =>
      expect(setInternalBillingAction).toHaveBeenCalledWith(
        'org_1',
        false,
        'Moved to a paying plan',
      ),
    );
  });

  it('names each failure rather than showing one generic error', async () => {
    setInternalBillingAction.mockResolvedValueOnce({
      ok: false,
      code: 'NOT_PERMITTED',
    } as never);
    renderBar(false);
    fireEvent.click(screen.getByRole('button', { name: /Classify as internal billing/i }));
    fireEvent.change(await screen.findByLabelText(/Reason/i), { target: { value: 'a reason' } });
    fireEvent.click(screen.getByRole('button', { name: /^Classify as internal$/i }));

    // The code maps to its OWN line of copy — the whole reason the action returns
    // a discriminated result instead of throwing.
    expect(await screen.findByText(/cannot change a billing classification/i)).toBeTruthy();
  });
});
