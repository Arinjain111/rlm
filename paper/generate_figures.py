"""
Generate all figures for the RLM IEEE paper.
Run: python paper/generate_figures.py
Outputs figures to paper/figures/
"""

import os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch
import matplotlib.gridspec as gridspec

FIGURES_DIR = os.path.join(os.path.dirname(__file__), "figures")
os.makedirs(FIGURES_DIR, exist_ok=True)

# ─── Style ─────────────────────────────────────────────────────────────────
plt.rcParams.update({
    "font.family": "serif",
    "font.size": 10,
    "axes.titlesize": 11,
    "axes.labelsize": 10,
    "xtick.labelsize": 9,
    "ytick.labelsize": 9,
    "legend.fontsize": 9,
    "figure.dpi": 150,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.grid": True,
    "grid.alpha": 0.4,
    "grid.linestyle": "--",
})

# Color palette
BLUE   = "#2563EB"
ORANGE = "#EA580C"
GREEN  = "#16A34A"
GRAY   = "#6B7280"
LIGHT  = "#DBEAFE"
RED    = "#DC2626"
PURPLE = "#7C3AED"

# ──────────────────────────────────────────────────────────────────────────
# Figure 1 – RLM Architecture Block Diagram
# ──────────────────────────────────────────────────────────────────────────
def fig_architecture():
    fig, ax = plt.subplots(figsize=(8, 4.2))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 5)
    ax.axis("off")

    def box(x, y, w, h, color, label, sublabel="", fontsize=9, radius=0.2):
        rect = FancyBboxPatch((x, y), w, h,
                              boxstyle=f"round,pad={radius}",
                              facecolor=color, edgecolor="black",
                              linewidth=1.4, zorder=3)
        ax.add_patch(rect)
        cy = y + h / 2
        ax.text(x + w / 2, cy + (0.18 if sublabel else 0), label,
                ha="center", va="center", fontsize=fontsize,
                fontweight="bold", zorder=4)
        if sublabel:
            ax.text(x + w / 2, cy - 0.25, sublabel,
                    ha="center", va="center", fontsize=7.5,
                    color="#374151", style="italic", zorder=4)

    def arrow(x1, y1, x2, y2, label="", color="black", style="->",
              lw=1.4, labelside="top"):
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                    arrowprops=dict(arrowstyle=style, color=color,
                                   lw=lw, connectionstyle="arc3,rad=0"))
        if label:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            dy = 0.22 if labelside == "top" else -0.22
            ax.text(mx, my + dy, label, ha="center", va="center",
                    fontsize=7.5, color=color)

    # Caller box
    box(0.2, 3.5, 2.0, 1.0, LIGHT, "Caller", "rlm.completion(context, Q)")

    # RLM Engine
    box(2.9, 2.5, 3.6, 2.2, "#FEF3C7",  "RLM Engine", "rlm/core/rlm.py")

    # Root LM inside engine
    box(3.1, 3.3, 1.5, 1.0, BLUE, "Root LM", "depth=0", fontsize=8, radius=0.12)

    # LM Handler
    box(5.1, 3.3, 1.2, 1.0, "#E0E7FF", "LM Handler", "TCP server", fontsize=7.5, radius=0.12)

    # REPL Env
    box(3.1, 2.55, 3.1, 0.7, "#F0FDF4", "REPL Environment", "context = [...]", fontsize=8, radius=0.12)

    # Sub-LM
    box(7.7, 2.8, 1.9, 1.2, "#FEE2E2", "Sub-LM / Child", "depth=1", fontsize=8, radius=0.12)

    # Final answer
    box(7.7, 1.2, 1.9, 0.9, "#F0FDF4", "FINAL(answer)", "", fontsize=8, radius=0.12)

    # Arrows
    arrow(2.2, 4.0, 2.9, 4.0, "completion()", color=BLUE)
    arrow(3.7, 3.3, 3.7, 3.25, "", color="black", lw=1.2)       # root LM → REPL
    ax.annotate("code cell", xy=(3.7, 3.0), xytext=(3.7, 3.3),
                arrowprops=dict(arrowstyle="->", color="black", lw=1.2),
                fontsize=7, ha="center")
    # REPL → Sub-LM
    arrow(6.2, 2.9, 7.7, 3.2, "rlm_query(prompt)", color=ORANGE, labelside="top")
    # Sub-LM → REPL back
    ax.annotate("", xy=(6.2, 2.65), xytext=(7.7, 2.85),
                arrowprops=dict(arrowstyle="->", color=GREEN, lw=1.1,
                                connectionstyle="arc3,rad=0.2"))
    ax.text(6.95, 2.6, "response", ha="center", fontsize=7.5, color=GREEN)
    # LM Handler ↔ Root LM
    ax.annotate("", xy=(5.1, 3.9), xytext=(4.6, 3.9),
                arrowprops=dict(arrowstyle="<->", color=GRAY, lw=1.1))
    ax.text(4.85, 4.05, "TCP", ha="center", fontsize=7, color=GRAY)
    # REPL → Final answer
    arrow(8.65, 2.8, 8.65, 2.1, "FINAL_VAR()", color=GREEN, labelside="top")

    ax.set_title("Fig. 1 — Recursive Language Model (RLM) System Architecture",
                 fontsize=10, fontweight="bold", pad=8)
    fig.tight_layout()
    path = os.path.join(FIGURES_DIR, "fig1_architecture.pdf")
    fig.savefig(path, bbox_inches="tight")
    fig.savefig(path.replace(".pdf", ".png"), bbox_inches="tight", dpi=150)
    print(f"Saved: {path}")
    plt.close(fig)


# ──────────────────────────────────────────────────────────────────────────
# Figure 2 – OOLONG Benchmark Results (128k and 263k)
# ──────────────────────────────────────────────────────────────────────────
def fig_oolong():
    methods = ["GPT-5-mini", "GPT-5", "ReAct+\nGPT-5+BM25",
               "RLM(GPT-5)\nw/o sub-calls", "RLM\n(GPT-5-mini)"]
    scores_128k = [0.15, 0.31, 0.20, 0.38, 0.52]
    scores_263k = [0.10, 0.31, 0.18, 0.30, 0.43]

    x = np.arange(len(methods))
    width = 0.34
    colors_128 = [GRAY, BLUE, PURPLE, "#F59E0B", ORANGE]
    colors_263 = [c + "99" for c in ["#6B7280", "#2563EB", "#7C3AED", "#F59E0B", "#EA580C"]]
    # Use alpha instead
    colors_263 = colors_128

    fig, axes = plt.subplots(1, 2, figsize=(9, 3.8), sharey=True)

    for ax, scores, title in zip(axes,
                                  [scores_128k, scores_263k],
                                  ["(a) ~128k Token Context", "(b) ~263k Token Context"]):
        bars = ax.bar(x, scores, width * 2, color=colors_128, edgecolor="white",
                      linewidth=0.8, zorder=3)
        # Highlight RLM bar
        bars[-1].set_edgecolor(ORANGE)
        bars[-1].set_linewidth(2.2)

        for bar, score in zip(bars, scores):
            ax.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.012,
                    f"{score:.2f}", ha="center", va="bottom", fontsize=8.5,
                    fontweight="bold")

        ax.set_xticks(x)
        ax.set_xticklabels(methods, fontsize=8)
        ax.set_ylim(0, 0.68)
        ax.set_ylabel("Score" if ax == axes[0] else "")
        ax.set_title(title, fontsize=10, fontweight="bold")
        ax.axhline(y=scores_128k[1], color=BLUE, linestyle=":", lw=1.2,
                   label="GPT-5 baseline")

    fig.suptitle("Fig. 2 — OOLONG Benchmark: trec_coarse Split (>128k token queries)",
                 fontsize=10, fontweight="bold", y=1.01)

    # Shared legend
    legend_patches = [
        mpatches.Patch(color=GRAY, label="GPT-5-mini"),
        mpatches.Patch(color=BLUE, label="GPT-5"),
        mpatches.Patch(color=PURPLE, label="ReAct+BM25"),
        mpatches.Patch(color="#F59E0B", label="RLM (no sub-calls)"),
        mpatches.Patch(color=ORANGE, label="RLM(GPT-5-mini) ★"),
    ]
    fig.legend(handles=legend_patches, loc="lower center",
               ncol=5, bbox_to_anchor=(0.5, -0.08), fontsize=8.5,
               framealpha=0.9)
    fig.tight_layout()
    path = os.path.join(FIGURES_DIR, "fig2_oolong.pdf")
    fig.savefig(path, bbox_inches="tight")
    fig.savefig(path.replace(".pdf", ".png"), bbox_inches="tight", dpi=150)
    print(f"Saved: {path}")
    plt.close(fig)


# ──────────────────────────────────────────────────────────────────────────
# Figure 3 – BrowseComp-Plus Results
# ──────────────────────────────────────────────────────────────────────────
def fig_browsecomp():
    doc_counts = [10, 50, 100, 1000]
    x = np.log10(doc_counts)
    xtick_labels = ["10\n(~200k)", "50\n(~1M)", "100\n(~2M)", "1000\n(~10M)"]

    data = {
        "GPT-5 (full ctx)":          ([1.00, 0.85, 0.70, None], BLUE,   "o",  "-"),
        "GPT-5 (Truncated)":         ([1.00, 0.80, 0.65, 0.30], GRAY,   "s",  "--"),
        "GPT-5 + Pre-query BM25":    ([1.00, 0.80, 0.75, 0.55], PURPLE, "^",  "-."),
        "ReAct+GPT-5+BM25":          ([1.00, 0.85, 0.80, 0.70], "#F59E0B", "D", ":"),
        "RLM(GPT-5) no-sub":          ([1.00, 0.95, 0.95, 0.90], GREEN,  "v",  "--"),
        "RLM(GPT-5) [best]":          ([1.00, 1.00, 1.00, 1.00], ORANGE, "*",  "-"),
    }

    fig, (ax_main, ax_cost) = plt.subplots(1, 2, figsize=(10, 4.0))

    for label, (scores, color, marker, ls) in data.items():
        xs, ys = [], []
        for xi, s in zip(x, scores):
            if s is not None:
                xs.append(xi)
                ys.append(s)
        lw = 2.4 if "★" in label else 1.5
        ms = 9 if "★" in label else 6
        ax_main.plot(xs, ys, marker=marker, color=color, linewidth=lw,
                     markersize=ms, linestyle=ls, label=label, zorder=3)

    ax_main.set_xticks(x)
    ax_main.set_xticklabels(xtick_labels, fontsize=8.5)
    ax_main.set_xlabel("Number of Documents in Context (approx. tokens)", fontsize=9.5)
    ax_main.set_ylabel("Accuracy", fontsize=9.5)
    ax_main.set_ylim(0.15, 1.08)
    ax_main.set_title("(a) Accuracy vs. Document Count", fontsize=10, fontweight="bold")
    ax_main.legend(fontsize=7.8, loc="lower left", framealpha=0.9)

    # Cost subplot (relative cost illustration)
    methods_cost = ["GPT-5\n(OOM at 1k)", "GPT-5+BM25", "ReAct+\nBM25", "RLM\n(GPT-5)"]
    costs = [None, 1.0, 1.8, 1.4]
    colors_cost = [BLUE, PURPLE, "#F59E0B", ORANGE]
    valid_idx = [i for i, c in enumerate(costs) if c is not None]
    ax_cost.bar([methods_cost[i] for i in valid_idx],
                [costs[i] for i in valid_idx],
                color=[colors_cost[i] for i in valid_idx],
                edgecolor="white", linewidth=0.8, zorder=3, width=0.5)
    ax_cost.bar(["GPT-5\n(OOM at 1k)"], [2.5], color=RED, alpha=0.3,
                edgecolor=RED, linewidth=1.2, linestyle="--", zorder=3, width=0.5)
    ax_cost.text(0, 2.6, "N/A\n(OOM)", ha="center", fontsize=8, color=RED)
    ax_cost.set_ylabel("Relative Cost per Query\n(GPT-5+BM25 = 1.0)", fontsize=9)
    ax_cost.set_title("(b) Relative Cost at 1000 Docs", fontsize=10, fontweight="bold")
    ax_cost.set_ylim(0, 3.2)

    fig.suptitle("Fig. 3 — BrowseComp-Plus: Accuracy and Cost vs. Document Scale",
                 fontsize=10, fontweight="bold", y=1.01)
    fig.tight_layout()
    path = os.path.join(FIGURES_DIR, "fig3_browsecomp.pdf")
    fig.savefig(path, bbox_inches="tight")
    fig.savefig(path.replace(".pdf", ".png"), bbox_inches="tight", dpi=150)
    print(f"Saved: {path}")
    plt.close(fig)


# ──────────────────────────────────────────────────────────────────────────
# Figure 4 – Emergent RLM Strategies (Timeline / Flow diagram)
# ──────────────────────────────────────────────────────────────────────────
def fig_strategies():
    fig, ax = plt.subplots(figsize=(10, 4.5))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 5)
    ax.axis("off")

    strategies = [
        ("Peeking",       0.3,  "#DBEAFE", BLUE,
         "print(context[:2000])\n# Observe structure"),
        ("Grepping",      2.7,  "#FEF3C7", "#D97706",
         "re.findall(pattern, context)\n# Narrow search space"),
        ("Partition+Map", 5.1,  "#F0FDF4", GREEN,
         "rlm_query_batched(chunks)\n# Parallel sub-calls"),
        ("Summarize",     7.5,  "#FDF4FF", PURPLE,
         "llm_query(doc_subset)\n# Hierarchical summary"),
    ]

    for name, x0, bg, fg, code in strategies:
        # Main box
        rect = FancyBboxPatch((x0, 2.6), 2.1, 2.0,
                              boxstyle="round,pad=0.18",
                              facecolor=bg, edgecolor=fg,
                              linewidth=1.8, zorder=3)
        ax.add_patch(rect)
        ax.text(x0 + 1.05, 4.3, name, ha="center", va="center",
                fontsize=9.5, fontweight="bold", color=fg, zorder=4)
        ax.text(x0 + 1.05, 3.45, code, ha="center", va="center",
                fontsize=7.2, family="monospace", color="#1F2937",
                zorder=4, linespacing=1.6)

    # connecting arrows between strategies
    for xi in [2.4, 4.8, 7.2]:
        ax.annotate("", xy=(xi + 0.3, 3.6), xytext=(xi, 3.6),
                    arrowprops=dict(arrowstyle="->", color=GRAY, lw=1.5))

    # Bottom row: description
    descs = [
        (1.35, "Infer context\nstructure"),
        (3.75, "Reduce search\nspace (zero-index)"),
        (6.15, "Semantic labeling\nat scale"),
        (8.55, "Build answer\nhierarchically"),
    ]
    for x_c, txt in descs:
        ax.text(x_c, 2.3, txt, ha="center", va="top",
                fontsize=8, color="#4B5563",
                bbox=dict(boxstyle="round,pad=0.25", fc="white",
                          ec=GRAY, alpha=0.8))

    # FINAL answer at right end
    ax.annotate("", xy=(9.8, 3.6), xytext=(9.6, 3.6),
                arrowprops=dict(arrowstyle="->", color=ORANGE, lw=2.0))
    rect2 = FancyBboxPatch((9.82, 3.2), 0.15, 0.8,
                           boxstyle="round,pad=0.1", facecolor=ORANGE,
                           edgecolor=ORANGE, linewidth=1.5, zorder=3)
    ax.add_patch(rect2)
    ax.text(9.89, 3.6, "✓", ha="center", va="center",
            fontsize=10, color="white", fontweight="bold", zorder=4)

    ax.set_title("Fig. 4 — Emergent Behavioral Strategies in RLM Trajectories",
                 fontsize=10, fontweight="bold", pad=14)
    fig.tight_layout()
    path = os.path.join(FIGURES_DIR, "fig4_strategies.pdf")
    fig.savefig(path, bbox_inches="tight")
    fig.savefig(path.replace(".pdf", ".png"), bbox_inches="tight", dpi=150)
    print(f"Saved: {path}")
    plt.close(fig)


# ──────────────────────────────────────────────────────────────────────────
# Figure 5 – Post-training: RLM-Qwen3-8B Results
# ──────────────────────────────────────────────────────────────────────────
def fig_posttraining():
    tasks = ["Task 1\n(OOLONG)", "Task 2\n(BrowseComp)", "Task 3\n(LoCoDiff)", "Task 4\n(Avg)"]
    qwen3 = [0.41, 0.38, 0.35, 0.39]
    gpt5  = [0.63, 0.59, 0.61, 0.61]
    rlm_q = [0.55, 0.51, 0.48, 0.515]

    x = np.arange(len(tasks))
    width = 0.26

    fig, ax = plt.subplots(figsize=(8, 4.0))

    b1 = ax.bar(x - width, qwen3, width, color=GRAY,   label="Qwen3-8B (vanilla)", zorder=3)
    b2 = ax.bar(x,         gpt5,  width, color=BLUE,   label="GPT-5 (vanilla)",    zorder=3)
    b3 = ax.bar(x + width, rlm_q, width, color=ORANGE, label="RLM-Qwen3-8B ★",    zorder=3)

    # Annotation: +28.3% avg improvement
    last_b1 = b1[-1]
    last_b3 = b3[-1]
    ax.annotate("", xy=(last_b3.get_x() + last_b3.get_width() / 2, last_b3.get_height()),
                xytext=(last_b1.get_x() + last_b1.get_width() / 2, last_b1.get_height()),
                arrowprops=dict(arrowstyle="<->", color=RED, lw=1.6))
    ax.text(x[-1] + 0.01, (qwen3[-1] + rlm_q[-1]) / 2 + 0.01, "+28.3%↑",
            ha="left", fontsize=8.5, color=RED, fontweight="bold")

    for bars in [b1, b2, b3]:
        for bar in bars:
            ax.text(bar.get_x() + bar.get_width() / 2,
                    bar.get_height() + 0.008,
                    f"{bar.get_height():.2f}",
                    ha="center", va="bottom", fontsize=7.5, fontweight="bold")

    ax.set_xticks(x)
    ax.set_xticklabels(tasks, fontsize=9)
    ax.set_ylabel("Accuracy / Score", fontsize=9.5)
    ax.set_ylim(0, 0.82)
    ax.set_title("Fig. 5 — Post-trained RLM-Qwen3-8B vs. Qwen3-8B and GPT-5",
                 fontsize=10, fontweight="bold")
    ax.legend(fontsize=8.5, loc="upper right", framealpha=0.9)

    fig.tight_layout()
    path = os.path.join(FIGURES_DIR, "fig5_posttraining.pdf")
    fig.savefig(path, bbox_inches="tight")
    fig.savefig(path.replace(".pdf", ".png"), bbox_inches="tight", dpi=150)
    print(f"Saved: {path}")
    plt.close(fig)


# ──────────────────────────────────────────────────────────────────────────
# Figure 6 – Isolated vs Non-Isolated Communication (protocol diagram)
# ──────────────────────────────────────────────────────────────────────────
def fig_protocol():
    fig, axes = plt.subplots(1, 2, figsize=(10, 4.2))

    for ax in axes:
        ax.set_xlim(0, 6)
        ax.set_ylim(0, 5)
        ax.axis("off")

    def box(ax, x, y, w, h, bg, edge, label, sub="", fs=8.5):
        rect = FancyBboxPatch((x, y), w, h,
                              boxstyle="round,pad=0.15",
                              facecolor=bg, edgecolor=edge,
                              linewidth=1.5, zorder=3)
        ax.add_patch(rect)
        cy = y + h / 2
        ax.text(x + w / 2, cy + (0.15 if sub else 0), label,
                ha="center", va="center", fontsize=fs,
                fontweight="bold", zorder=4)
        if sub:
            ax.text(x + w / 2, cy - 0.2, sub,
                    ha="center", va="center", fontsize=7, color="#374151",
                    style="italic", zorder=4)

    def arrow2(ax, x1, y1, x2, y2, label="", color="black", ls="-"):
        ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                    arrowprops=dict(arrowstyle="->", color=color,
                                   lw=1.4, linestyle=ls))
        if label:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            ax.text(mx + 0.05, my + 0.15, label, ha="center",
                    fontsize=7.5, color=color)

    # ── Left: Non-Isolated (LocalREPL) ──────────────────────────────────
    ax = axes[0]
    ax.set_title("(a) Non-Isolated: Local/Docker REPL\n(TCP Socket Protocol)",
                 fontsize=9.5, fontweight="bold")

    box(ax, 0.2, 3.5, 2.0, 0.9, LIGHT, BLUE, "RLM Engine", "host process")
    box(ax, 3.6, 3.5, 2.0, 0.9, "#E0E7FF", BLUE, "LM Handler", "ThreadingTCPServer")
    box(ax, 0.2, 1.8, 2.0, 0.9, "#F0FDF4", GREEN, "LocalREPL", "exec() in-process")
    box(ax, 3.6, 1.8, 2.0, 0.9, "#FEF3C7", "#D97706", "LM Client", "API calls")

    arrow2(ax, 2.2, 3.95, 3.6, 3.95, "spawn & start()", BLUE)
    arrow2(ax, 3.6, 3.5, 2.2, 3.5, "TCP socket", GRAY, ls="--")
    arrow2(ax, 1.2, 3.5, 1.2, 2.7, "env_kwargs", GRAY)
    arrow2(ax, 1.2, 1.8, 1.2, 1.2, "llm_query()", GREEN)
    arrow2(ax, 1.5, 1.2, 3.6, 2.1, "JSON payload\n4-byte prefix", "#D97706")
    arrow2(ax, 4.6, 1.8, 4.6, 1.2, "API call", BLUE)
    ax.text(0.9, 0.85, "4-byte length + UTF-8 JSON", fontsize=7,
            color=GRAY, style="italic")

    # ── Right: Isolated (Modal/E2B) ─────────────────────────────────────
    ax = axes[1]
    ax.set_title("(b) Isolated: Modal/E2B/Prime REPL\n(HTTP Broker Pattern)",
                 fontsize=9.5, fontweight="bold")

    # Host machine
    rect_host = FancyBboxPatch((0.1, 2.5), 2.5, 2.2,
                               boxstyle="round,pad=0.1",
                               facecolor="#F8FAFC", edgecolor=BLUE,
                               linestyle="--", linewidth=1.5, zorder=1)
    ax.add_patch(rect_host)
    ax.text(1.35, 4.6, "Host Machine", ha="center", fontsize=8,
            color=BLUE, fontweight="bold")

    # Cloud sandbox
    rect_cloud = FancyBboxPatch((3.3, 0.5), 2.5, 4.2,
                                boxstyle="round,pad=0.1",
                                facecolor="#FFF7ED", edgecolor=ORANGE,
                                linestyle="--", linewidth=1.5, zorder=1)
    ax.add_patch(rect_cloud)
    ax.text(4.55, 4.6, "Cloud Sandbox", ha="center", fontsize=8,
            color=ORANGE, fontweight="bold")

    box(ax, 0.3, 3.4, 2.0, 0.85, LIGHT, BLUE, "LM Handler", "TCP server", fs=8)
    box(ax, 0.3, 2.7, 2.0, 0.6,  "#E0E7FF", BLUE, "Poller Thread", "100ms", fs=7.5)

    box(ax, 3.5, 3.4, 2.0, 0.85, "#FEE2E2", ORANGE, "Flask Broker", "/enqueue /respond", fs=7.5)
    box(ax, 3.5, 2.2, 2.0, 0.85, "#F0FDF4", GREEN, "Exec Script", "llm_query()", fs=8)
    box(ax, 3.5, 0.8, 2.0, 0.85, "#EDE9FE", PURPLE, "LM Client", "OpenAI API", fs=8)

    # Encrypted tunnel
    ax.annotate("", xy=(3.5, 3.82), xytext=(2.3, 3.82),
                arrowprops=dict(arrowstyle="<->", color=RED, lw=1.6))
    ax.text(2.9, 4.0, "Encrypted\nTunnel", ha="center", fontsize=7.5, color=RED)

    arrow2(ax, 1.3, 2.7, 1.3, 2.0, "", GRAY)
    ax.text(0.35, 2.3, "poll /pending\nPOST /respond", fontsize=7, color=GRAY, style="italic")

    arrow2(ax, 4.5, 2.2, 4.5, 1.65, "/enqueue", "#D97706")
    arrow2(ax, 4.5, 0.8, 4.5, 0.4, "API call", BLUE)

    fig.suptitle("Fig. 6 — RLM Communication Protocols: Non-Isolated vs. Isolated Environments",
                 fontsize=10, fontweight="bold", y=1.01)
    fig.tight_layout()
    path = os.path.join(FIGURES_DIR, "fig6_protocol.pdf")
    fig.savefig(path, bbox_inches="tight")
    fig.savefig(path.replace(".pdf", ".png"), bbox_inches="tight", dpi=150)
    print(f"Saved: {path}")
    plt.close(fig)


# ──────────────────────────────────────────────────────────────────────────
# Figure 7 – Context Size vs. Model Performance (context rot illustration)
# ──────────────────────────────────────────────────────────────────────────
def fig_context_rot():
    ctx_k = np.array([32, 64, 128, 192, 263])

    perf = {
        "GPT-5-mini":         np.array([0.45, 0.35, 0.15, 0.12, 0.10]),
        "GPT-5":              np.array([0.55, 0.50, 0.31, 0.31, 0.31]),
        "ReAct+GPT-5+BM25":   np.array([0.38, 0.30, 0.20, 0.19, 0.18]),
        "RLM(GPT-5-mini) [best]": np.array([0.60, 0.57, 0.52, 0.47, 0.43]),
    }
    colors = [GRAY, BLUE, PURPLE, ORANGE]
    markers = ["s", "o", "^", "*"]
    lws = [1.4, 1.4, 1.4, 2.6]
    mss = [6, 6, 6, 9]

    fig, ax = plt.subplots(figsize=(7.5, 3.8))

    for (label, vals), color, marker, lw, ms in zip(
            perf.items(), colors, markers, lws, mss):
        ax.plot(ctx_k, vals, marker=marker, color=color,
                linewidth=lw, markersize=ms, label=label, zorder=3)
        if "best" in label or "RLM" in label:
            ax.fill_between(ctx_k, vals, alpha=0.10, color=color)

    # Shade the "context rot zone"
    ax.axvspan(128, 263, alpha=0.06, color=RED, label="Context Rot Zone (>128k)")

    ax.set_xlabel("Context Window Size (thousands of tokens)", fontsize=9.5)
    ax.set_ylabel("Benchmark Score", fontsize=9.5)
    ax.set_xlim(20, 275)
    ax.set_ylim(0.0, 0.75)
    ax.set_xticks(ctx_k)
    ax.set_xticklabels([f"{k}k" for k in ctx_k], fontsize=9)
    ax.set_title("Fig. 7 — Context Rot: Performance Degradation vs. Context Length",
                 fontsize=10, fontweight="bold")
    ax.legend(fontsize=8.5, loc="lower left", framealpha=0.9)

    fig.tight_layout()
    path = os.path.join(FIGURES_DIR, "fig7_context_rot.pdf")
    fig.savefig(path, bbox_inches="tight")
    fig.savefig(path.replace(".pdf", ".png"), bbox_inches="tight", dpi=150)
    print(f"Saved: {path}")
    plt.close(fig)


# ──────────────────────────────────────────────────────────────────────────
# Run all
# ──────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    print("Generating RLM IEEE paper figures...")
    fig_architecture()
    fig_oolong()
    fig_browsecomp()
    fig_strategies()
    fig_posttraining()
    fig_protocol()
    fig_context_rot()
    print(f"\nAll figures saved to: {FIGURES_DIR}")
    print("Files generated:")
    for f in sorted(os.listdir(FIGURES_DIR)):
        print(f"  {f}")
