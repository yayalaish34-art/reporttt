'use client';

import Link from 'next/link';

/**
 * The screen the system opens on.
 *
 * It used to open on the list of radiation reports, which is the wrong shape for
 * what actually happens: the app is opened to write a survey, and the first act
 * was always to find the "דוח חדש" button among a page of finished work. So the
 * four kinds are the screen, one large target each, and pressing one starts a
 * survey.
 *
 * There was briefly a "continue the last draft" button beside each. It went: the
 * title it had to show is assembled from fields a new report has not got yet, so
 * it read "המשך — דיווח תוצאות בדיקת ריכוזי גז הראדון — —", and a button whose
 * label is mostly dashes tells nobody what they would be returning to. Opening the
 * app means starting a survey; an earlier one is found in its own list, where it
 * sits beside the date and the site that identify it.
 */
export function StartScreen() {
  const kinds = [
    {
      key: 'radiation' as const,
      title: 'דוח קרינה',
      blurb: 'מדידות שדה מגנטי ELF וצפיפות הספק RF',
      icon: '📡',
      newHref: '/reports/new',
      listHref: '/reports',
    },
    {
      key: 'radon' as const,
      title: 'דוח ראדון',
      blurb: 'גלאים, תוצאות מעבדה ורמות פעולה',
      icon: '🧪',
      newHref: '/radon/new',
      listHref: '/radon',
    },
    {
      key: 'asbestos' as const,
      title: 'דוח אסבסט',
      blurb: 'חוות דעת — סקר ויזואלי, ממצאים ותמונות',
      icon: '🏗️',
      newHref: '/asbestos/new',
      listHref: '/asbestos',
    },
    {
      key: 'mold' as const,
      title: 'דוח עובשים',
      blurb: 'דיגום אוויר ומשטח, תוצאות מעבדה ובדיקת לחות',
      icon: '🧫',
      newHref: '/mold/new',
      listHref: '/mold',
    },
    {
      key: 'iaq' as const,
      title: 'דוח איכות אוויר',
      blurb: 'מדידות תוך-מבניות: CO₂, CO, NO₂, SO₂, VOC, פורמלדהיד, טמפ׳ ולחות',
      icon: '💨',
      newHref: '/iaq/new',
      listHref: '/iaq',
    },
  ];

  return (
    <div className="start-grid">
      {kinds.map((kind) => (
        <section className="start-card" key={kind.key}>
          <div className="start-head">
            <span className="start-icon" aria-hidden="true">
              {kind.icon}
            </span>
            <div>
              <h2>{kind.title}</h2>
              <p>{kind.blurb}</p>
            </div>
          </div>

          {/* A plain anchor rather than a <Link>: this route creates a report and
              redirects, so prefetching it would create one for every card the
              router happened to look at. */}
          <a className="btn-primary start-action" href={kind.newHref}>
            דוח חדש
          </a>

          {/* A button rather than the small link this was: finding an existing report
              is half of what the screen is for, and a line of grey text under two
              large targets read as a footnote. */}
          <Link className="btn start-action start-secondary" href={kind.listHref} prefetch={false}>
            כל הדוחות
          </Link>
        </section>
      ))}
    </div>
  );
}
