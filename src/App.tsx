function App() {
  return (
    <>
      <aside className="border-r-2 border-gray-800 w-16 flex flex-col items-center py-4">
        <button className="p-2 mb-2 hover:bg-gray-600 text-gray-800 dark:text-gray-400 rounded-md transition-colors">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </button>
        {Array.from({ length: 5 }).map(() => (
          <Icon />
        ))}
        <Icon />
      </aside>
    </>
  );
}

function Icon() {
  return (
    <button className="p-2 hover:bg-gray-600 rounded-md transition-colors">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="18" x2="20" y2="18" />
      </svg>
    </button>
  )
}

export default App;