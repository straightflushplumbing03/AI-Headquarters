"""Real, read-only tools. Each is gated by a permission name on the agent record.

There is deliberately no tool that sends messages, publishes, spends money or writes to a website.
Those actions only exist as approval requests that the owner decides.
"""
from __future__ import annotations

import ipaddress
import re
import socket
from html import unescape
from urllib.parse import urlparse

import httpx

USER_AGENT = "StraightFlushIntelligenceHQ/0.1 (+https://straightflushplumbingoc.com)"
MAX_BYTES = 400_000


class ToolError(Exception):
    pass


class PermissionDenied(Exception):
    pass


def require(agent, tool: str) -> None:
    if tool not in (agent.permissions or []):
        raise PermissionDenied(f"agent {agent.id} lacks permission {tool}")


def _is_public_host(host: str) -> bool:
    if not host or host in ("localhost",) or host.endswith(".local") or host.endswith(".internal"):
        return False
    try:
        ip = ipaddress.ip_address(host)
        return ip.is_global
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return True  # let the HTTP layer report the failure; name is not an IP literal
    return all(ipaddress.ip_address(i[4][0]).is_global for i in infos)


class Tools:
    def __init__(self, transport: httpx.BaseTransport | None = None, resolve_hosts: bool = True, timeout: float = 15.0):
        self._client = httpx.Client(timeout=timeout, transport=transport, follow_redirects=True,
                                    headers={"User-Agent": USER_AGENT})
        self._resolve = resolve_hosts

    # -- web.fetch -------------------------------------------------------------------------------------------------
    def fetch(self, url: str) -> dict:
        p = urlparse(url)
        if p.scheme not in ("http", "https"):
            raise ToolError(f"blocked scheme: {url}")
        if self._resolve and not _is_public_host(p.hostname or ""):
            raise ToolError(f"blocked non-public host: {p.hostname}")
        try:
            r = self._client.get(url)
        except httpx.HTTPError as e:
            raise ToolError(f"fetch failed for {url}: {e}") from e
        body = r.content[:MAX_BYTES].decode(r.encoding or "utf-8", errors="replace")
        return {"url": str(r.url), "status": r.status_code, "title": _title(body), "text": html_to_text(body)[:6000]}

    # -- site.audit ------------------------------------------------------------------------------------------------
    def site_audit(self, origin: str, max_pages: int = 15) -> dict:
        origin = origin.rstrip("/")
        sm = self.fetch(origin + "/sitemap.xml")
        if sm["status"] != 200:
            raise ToolError(f"sitemap returned HTTP {sm['status']}")
        raw = self._client.get(origin + "/sitemap.xml").text
        urls = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", raw)
        same = [u for u in urls if urlparse(u).netloc == urlparse(origin).netloc]
        pages, issues = [], []
        for u in same[:max_pages]:
            try:
                r = self._client.get(u)
            except httpx.HTTPError as e:
                issues.append({"url": u, "issue": f"fetch failed: {e}"})
                continue
            h = r.text
            title = _title(h)
            desc = _meta(h, "description")
            h1s = re.findall(r"<h1\b", h, re.I)
            page = {"url": u, "status": r.status_code, "title": title, "title_len": len(title),
                    "description_len": len(desc), "h1_count": len(h1s)}
            pages.append(page)
            if r.status_code != 200:
                issues.append({"url": u, "issue": f"HTTP {r.status_code}"})
            if not title:
                issues.append({"url": u, "issue": "missing <title>"})
            elif len(title) > 60:
                issues.append({"url": u, "issue": f"title {len(title)} chars (>60)"})
            if not desc:
                issues.append({"url": u, "issue": "missing meta description"})
            elif len(desc) > 160:
                issues.append({"url": u, "issue": f"meta description {len(desc)} chars (>160)"})
            if len(h1s) != 1:
                issues.append({"url": u, "issue": f"{len(h1s)} <h1> tags"})
        return {"origin": origin, "sitemap_urls": len(urls), "pages_checked": len(pages), "issues": issues,
                "pages": pages}


def _title(html: str) -> str:
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    return unescape(m.group(1).strip()) if m else ""


def _meta(html: str, name: str) -> str:
    m = re.search(rf'<meta[^>]+name=["\']{name}["\'][^>]*content=["\']([^"\']*)', html, re.I)
    return unescape(m.group(1)) if m else ""


def html_to_text(html: str) -> str:
    html = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\s+", " ", unescape(text)).strip()
