'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Customer } from '@/lib/customer-service';
import { customerContacts, findCustomers, freshCustomer } from '../../actions';
import type { CrmContact } from '@/lib/crm-contacts';

/** The recipient fields a customer fills in. */
export interface RecipientFields {
  /** The CRM's id for this customer — carried so the report can be filed back. */
  customerId: string;
  customerType: 'company' | 'private';
  recipientName: string;
  recipientTitle: string;
  companyName: string;
  addressLine: string;
  city: string;
  phone: string;
  email: string;
}

/**
 * Searches the customer directory and fills the recipient block.
 *
 * Results appear as you type. The search runs against the company name, the
 * contact name, the city and the contact details at once, because whoever is
 * writing up a survey remembers whichever of those they dealt with.
 */
export function CustomerPicker({ onPick }: { onPick: (fields: RecipientFields) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Debounced so a fast typist does not queue one round trip per keystroke.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(async () => {
      const found = await findCustomers(query);
      if (cancelled) return;
      setResults(found);
      setLoading(false);
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open]);

  // Clicking anywhere else closes the result list.
  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [open]);

  /**
   * The people at the company just picked.
   *
   * The directory here stores one contact per customer, which is right for a
   * private customer and wrong for a company: the report goes to whoever
   * ordered this survey, and a company with six contacts was collapsed to
   * whichever one happened to be primary at import. The full list is read from
   * the CRM the moment a company is chosen.
   */
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [contactsFor, setContactsFor] = useState<Customer | null>(null);
  /**
   * Shown while the CRM is answering.
   *
   * Without it the list simply is not there for a second or two, which reads as
   * "this company has no contacts" — and the surveyor moves on before the real
   * answer arrives.
   */
  const [loadingContacts, setLoadingContacts] = useState(false);
  /** Which contact the report is currently addressed to, so the list can show it. */
  const [pickedContactId, setPickedContactId] = useState<string | null>(null);
  /**
   * Whether the list of people is unfolded.
   *
   * Open on arrival — a company with several contacts is a choice that has to be
   * made, not one to go looking for — and folded once it is made.
   */
  const [contactsOpen, setContactsOpen] = useState(false);

  const pickContact = (contact: CrmContact) => {
    const customer = contactsFor;
    if (!customer) return;
    /*
     * The customer's own kind, not "company" flat.
     *
     * Picking a contact used to declare the recipient a company, which was safe while
     * only companies offered contacts. Now that a customer imported as "private" offers
     * them too — a מתנ"ס, a school — that would print a bold company line with nothing
     * on it, and drop the private recipient's own shape.
     */
    const isCompany = customer.kind === 'company';
    onPick({
      customerId: customer.id,
      customerType: customer.kind,
      recipientName: contact.fullName,
      recipientTitle: isCompany ? contact.roleTitle : '',
      companyName: isCompany ? customer.companyName : '',
      addressLine: customer.addressLine,
      city: customer.city,
      // The contact's own number and address win where they have one — that is
      // the person the report is addressed to, not the switchboard.
      phone: contact.phone || customer.phone,
      email: contact.email || customer.email,
    });
    setPicked(`${customer.companyName || customer.contactName} — ${contact.fullName}`);
    setPickedContactId(contact.id);
    // The list has done its job and folds away. Left open it pushed the rest of the
    // form down the screen for the whole of the survey, and on a phone that is most
    // of the step. Who was chosen is shown on the summary line, and the line reopens
    // the list if it was the wrong person.
    setContactsOpen(false);
  };

  /**
   * Which pick is current, so an answer that arrives after a second pick is dropped.
   *
   * The CRM can take a second or two; a surveyor who picks the wrong row and then the
   * right one must not have the first answer land on top of the second.
   */
  const pickToken = useRef(0);
  /** Waiting on the CRM for the picked customer's current details. */
  const [refreshing, setRefreshing] = useState(false);

  const pick = async (listed: Customer) => {
    const token = ++pickToken.current;
    setPicked(label(listed));
    setQuery('');
    setOpen(false);

    /*
     * Contacts are fetched for every customer, not only for companies.
     *
     * The kind is what the directory imported, and a great many organisations came over
     * as "private" — a מתנ"ס, a school, a ועד בית. Gating on it meant their contacts were
     * never looked up, so a report addressed to one printed no e-mail at all even though
     * the CRM held two for it. 6,300 customers have no address of their own on the row
     * and a contact who does.
     *
     * Fetching for a genuinely private customer costs one query that comes back empty,
     * which is a much smaller price than the address the report went out without.
     */
    setContactsFor(listed);
    setContacts([]);
    setPickedContactId(null);
    setContactsOpen(true);
    setLoadingContacts(true);
    void customerContacts(listed.id)
      .then((found) => {
        if (token === pickToken.current) setContacts(found);
      })
      .finally(() => {
        if (token === pickToken.current) setLoadingContacts(false);
      });

    /*
     * The customer as the CRM holds them now, not as the directory copied them.
     *
     * The copy is only as fresh as the last import, and a street is usually added in
     * the CRM after the lead was opened — which is how a report came to say "הרצליה,
     * הרצליה" for a customer whose card read "חנה רובינא 4". Waited on, with a ceiling:
     * past it the copy is used, exactly as before.
     */
    setRefreshing(true);
    const fresh = await Promise.race([
      freshCustomer(listed.id).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
    ]);
    if (token !== pickToken.current) return;
    setRefreshing(false);
    const customer = fresh ?? listed;
    setContactsFor(customer);

    onPick({
      // The id travels with the copy so the finished report can be filed back
      // onto this customer's card in the CRM.
      customerId: customer.id,
      customerType: customer.kind,
      recipientName: customer.contactName,
      // A private customer has no role or company; clear both so switching from
      // a company customer cannot leave the previous one's details behind.
      recipientTitle: customer.kind === 'company' ? customer.contactTitle : '',
      companyName: customer.kind === 'company' ? customer.companyName : '',
      addressLine: customer.addressLine,
      city: customer.city,
      phone: customer.phone,
      email: customer.email,
    });
    setPicked(label(customer));
  };

  return (
    <div className="field wide" ref={box} style={{ position: 'relative' }}>
      <label>חיפוש לקוח</label>
      <input
        value={query}
        placeholder="שם חברה, איש קשר, עיר, טלפון או דוא״ל"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />

      {picked && !open && (
        <span className="hint" style={{ color: refreshing ? undefined : 'var(--ok)', fontSize: 12 }}>
          {refreshing ? `מעדכן את פרטי ${picked} מה-CRM…` : `מולא מתוך: ${picked}`}
        </span>
      )}

      {/* ── אנשי הקשר של החברה ──
          Every contact the CRM holds, as a row each rather than a dropdown.
          A company routinely has several and the report is addressed to whichever
          of them ordered *this* survey; a collapsed <select> hid that choice
          behind a tap and defaulted to whoever happened to be primary at import,
          which is how reports went out addressed to the wrong person. */}
      {contactsFor && !open && (loadingContacts || contacts.length > 0) && (
        <div className="contact-choice">
          <label>
            איש קשר ב{contactsFor.companyName || contactsFor.contactName}
            {contacts.length > 0 && ` — ${contacts.length}`}
          </label>

          {loadingContacts ? (
            <div className="picker-empty">טוען אנשי קשר…</div>
          ) : contactsOpen ? (
            <div className="contact-list">
              {contacts.map((contact) => {
                const chosen = contact.id === pickedContactId;
                return (
                  <button
                    type="button"
                    key={contact.id}
                    className={`contact-row${chosen ? ' chosen' : ''}`}
                    onClick={() => pickContact(contact)}
                  >
                    <span className="contact-name">
                      {contact.fullName}
                      {contact.isPrimary && <span className="badge ok">ראשי</span>}
                      {chosen && <span className="badge ok">נבחר</span>}
                    </span>
                    <span className="contact-meta">
                      {[contact.roleTitle, contact.phone, contact.email].filter(Boolean).join(' · ') ||
                        'אין פרטי קשר'}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            /* Folded: who was chosen, and the way back if it was the wrong person. */
            <button type="button" className="contact-row chosen" onClick={() => setContactsOpen(true)}>
              <span className="contact-name">
                {contacts.find((c) => c.id === pickedContactId)?.fullName ?? 'לא נבחר איש קשר'}
                <span className="badge ok">נבחר</span>
              </span>
              {/* Hebrew, unlike the details this class usually carries, so the
                  left-to-right run set for phone numbers is turned back off. */}
              <span className="contact-meta" style={{ direction: 'rtl' }}>
                {contacts.length > 1 ? `החלפה — ${contacts.length} אנשי קשר` : 'החלפה'}
              </span>
            </button>
          )}

          {contactsOpen && contacts.length > 0 && (
            <span className="hint">הבחירה ממלאת גם את הטלפון והדוא״ל של אותו אדם.</span>
          )}
        </div>
      )}

      {open && (
        <div className="picker-results">
          {loading && results.length === 0 ? (
            <div className="picker-empty">מחפש…</div>
          ) : results.length === 0 ? (
            <div className="picker-empty">
              לא נמצאו לקוחות. <Link href="/customers">הוספת לקוח</Link>
            </div>
          ) : (
            results.map((customer) => (
              <button type="button" key={customer.id} className="picker-row" onClick={() => void pick(customer)}>
                <span className="picker-title">{label(customer)}</span>
                <span className="picker-meta">
                  <span className={`badge${customer.kind === 'private' ? '' : ' ok'}`}>
                    {customer.kind === 'private' ? 'פרטי' : 'חברה'}
                  </span>
                  {[customer.contactTitle, customer.city, customer.phone].filter(Boolean).join(' · ')}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function label(customer: Customer): string {
  return customer.kind === 'company' && customer.companyName
    ? `${customer.companyName} — ${customer.contactName}`
    : customer.contactName;
}
