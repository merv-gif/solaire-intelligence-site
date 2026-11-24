#!/usr/bin/env python3
"""Build a content page that reuses si-gateway.html's <head>, nav and footer.

  python3 scripts/build-page.py <slug> "<title>" "<description>" <body-fragment.html> ["Footer link text"]

Writes <slug>.html, adds it to sitemap.xml, and (if footer text is given) adds a
link under Resources in every page footer. Then run scripts/seo-tags.py after
adding the slug to its PAGES table.
"""
import re, sys, pathlib, datetime, html

slug, title, desc, frag = sys.argv[1:5]
footer_text = sys.argv[5] if len(sys.argv) > 5 else None
root = pathlib.Path(__file__).resolve().parent.parent
gw = (root / "si-gateway.html").read_text(encoding="utf-8")
body = pathlib.Path(frag).read_text(encoding="utf-8")

head_nav = re.sub(r"\n[ \t]*<!-- SEO:BEGIN.*?<!-- SEO:END -->(?:\n[ \t]*(?=\n))*", "", gw.split("<!-- ── Hero", 1)[0], flags=re.S)
head_nav = re.sub(r"<title>.*?</title>", f"<title>{html.escape(title, quote=False)}</title>", head_nav, flags=re.S)
head_nav = re.sub(r'<meta name="description" content=".*?" />',
                  f'<meta name="description" content="{html.escape(desc)}" />', head_nav, flags=re.S)
footer = "<footer>" + gw.split("<footer>", 1)[1].split("</footer>", 1)[0] + "</footer>\n"
scripts = f"""
<script>
  document.getElementById('navBurger').addEventListener('click', () => {{
    document.getElementById('navLinks').classList.toggle('open');
  }});
  document.querySelectorAll('.nav-links > li').forEach(li => {{
    li.addEventListener('mouseenter', () => li.classList.add('open'));
    li.addEventListener('mouseleave', () => li.classList.remove('open'));
  }});
  document.addEventListener('click', function(e){{
    var a = e.target.closest && e.target.closest('a[href*="wa.me/"]');
    if (!a || typeof gtag !== 'function') return;
    gtag('event', 'whatsapp_click', {{'link_text': (a.textContent||'').trim().slice(0,60), 'page': '{slug}'}});
  }});
</script>
</body>
</html>
"""
(root / f"{slug}.html").write_text(head_nav + body + "\n" + footer + scripts, encoding="utf-8")
print("ok", f"{slug}.html")

if footer_text:
    link = f'<li><a href="/{slug}">{footer_text}</a></li>'
    anchor = '<li><a href="/sunsynk-wifi-dongle-alternative">Sunsynk dongle alternative</a></li>'
    for f in sorted(root.glob("*.html")):
        h = f.read_text(encoding="utf-8")
        if link in h or anchor not in h:
            continue
        f.write_text(h.replace(anchor, anchor + "\n        " + link, 1), encoding="utf-8")
        print("footer link", f.name)

sm = root / "sitemap.xml"
s = sm.read_text(encoding="utf-8")
loc = f"https://solaire-intelligence.co.za/{slug}"
if loc + "<" not in s:
    today = datetime.date.today().isoformat()
    s = s.replace("</urlset>", f"  <url><loc>{loc}</loc><lastmod>{today}</lastmod><priority>0.8</priority></url>\n</urlset>")
    sm.write_text(s, encoding="utf-8")
    print("ok sitemap.xml")
