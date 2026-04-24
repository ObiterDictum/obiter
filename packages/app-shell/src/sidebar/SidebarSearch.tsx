import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'

export function SidebarSearch() {
  return (
    <div className="ormont-sidebar-search">
      <label className="ormont-sidebar-search__label" htmlFor="ormont-sidebar-search">
        Search workspace
      </label>
      <div className="ormont-sidebar-search__field">
        <MagnifyingGlassIcon aria-hidden="true" className="ormont-sidebar-search__icon" />
        <input
          id="ormont-sidebar-search"
          name="ormont-sidebar-search"
          placeholder="Search matters, drafts, research"
          type="search"
        />
      </div>
    </div>
  )
}
