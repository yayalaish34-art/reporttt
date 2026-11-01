'use client';

import { CustomerPicker } from '../reports/[id]/customer-picker';
import type { Installation } from '@/lib/radon-installation';

/** The recipient block, shared by the radon report and the detector installation. */
export type RadonCustomer = Pick<
  Installation,
  'customerId' | 'customerType' | 'recipientName' | 'companyName' | 'addressLine' | 'city' | 'phone' | 'email'
>;

export function RadonCustomerFields({
  customer,
  update,
}: {
  customer: RadonCustomer;
  update: (patch: Partial<RadonCustomer>) => void;
}) {
  return (
    <div>
      <div className="grid">
        <CustomerPicker
          onPick={(fields) =>
            update({
              customerId: fields.customerId,
              // Carried from the directory: a private customer picked here
              // must not leave the report set to "company".
              customerType: fields.customerType,
              recipientName: fields.recipientName,
              companyName: fields.customerType === 'company' ? fields.companyName : '',
              addressLine: fields.addressLine,
              city: fields.city,
              phone: fields.phone,
              email: fields.email,
            })
          }
        />
        <div className="field wide">
          <label>סוג לקוח</label>
          <div className="toggle">
            {(
              [
                ['company', 'חברה'],
                ['private', 'לקוח פרטי'],
              ] as const
            ).map(([value, text]) => (
              <button
                key={value}
                type="button"
                className={customer.customerType === value ? 'active' : undefined}
                onClick={() =>
                  // A private recipient has no company line; clearing it keeps
                  // a stale company from reappearing on a later switch back.
                  update(value === 'private' ? { customerType: value, companyName: '' } : { customerType: value })
                }
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        <Text
          label={customer.customerType === 'private' ? 'שם הלקוח' : 'איש הקשר'}
          placeholder="חובה"
          value={customer.recipientName}
          onChange={(v) => update({ recipientName: v })}
        />
        {customer.customerType === 'company' && (
          <Text label="שם החברה" value={customer.companyName} onChange={(v) => update({ companyName: v })} />
        )}
        {/* Same labelling as the radiation report: whose address, whose
            telephone. The two forms describe the same recipient. */}
        <Text
          label={customer.customerType === 'private' ? 'כתובת הלקוח' : 'כתובת החברה'}
          value={customer.addressLine}
          onChange={(v) => update({ addressLine: v })}
        />
        <Text label="ישוב" value={customer.city} onChange={(v) => update({ city: v })} />
        <Text
          label={customer.customerType === 'private' ? 'נייד' : 'נייד איש הקשר'}
          value={customer.phone}
          onChange={(v) => update({ phone: v })}
          ltr
        />
        <Text
          label={customer.customerType === 'private' ? 'דוא״ל' : 'דוא״ל איש הקשר'}
          value={customer.email}
          onChange={(v) => update({ email: v })}
          ltr
        />
      </div>
    </div>
  );
}

export function Text({
  label,
  value,
  onChange,
  ltr,
  wide,
  optional,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  ltr?: boolean;
  wide?: boolean;
  /** Left out of the step's field count — a line that may legitimately stay empty. */
  optional?: boolean;
  /**
   * Shown in the empty box.
   *
   * Where a field is required this carries "חובה", so the demand sits inside the box the
   * surveyor is looking at rather than in a parenthetical on the label — and it clears
   * itself the moment anything is typed, which a label cannot do.
   */
  placeholder?: string;
}) {
  // `needed` is what the phone stylesheet draws the waiting-mark from, and `data-filled`
  // is what the step header counts. Both derive from the value, so the mark and the
  // count cannot disagree with the box they describe.
  const needed = !optional;
  return (
    <div
      className={`field${wide ? ' wide' : ''}${needed ? ' needed' : ''}`}
      data-filled={needed ? (value.trim() !== '' ? 'true' : 'false') : undefined}
    >
      <label>{label}</label>
      <input
        className={ltr ? 'ltr' : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
