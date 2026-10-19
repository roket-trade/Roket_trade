<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## UI components

- Build interactive UI in app pages with plain React state instead of rendering Radix-based shadcn primitives from `src/components/ui`. Radix's collection hooks threw a null React dispatcher under Vite's dependency optimization and blanked the whole page, so keep app pages free of that dependency surface.
