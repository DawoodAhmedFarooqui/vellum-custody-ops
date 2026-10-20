import { DataGrid } from '@mui/x-data-grid'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, qs } from '../api.js'

const PAGE_SIZES = [25, 50, 100]

// Loads one page of rows for a grid. Paging and sorting come from the URL (urlState),
// filters are passed in by the page. Fixed params (e.g. a client id) are merged in.
export function useServerRows({ url, urlState, filters, fixed = {}, defaultSort }) {
  const params = {
    ...fixed,
    ...filters,
    page: urlState.get('page') || 0,
    pageSize: urlState.get('pageSize') || PAGE_SIZES[1],
    sort: urlState.get('sort') || defaultSort.field,
    dir: urlState.get('dir') || defaultSort.dir,
  }
  const query = qs(params)
  const result = useQuery({
    queryKey: [url, query],
    queryFn: () => api.get(`${url}${query}`),
    placeholderData: keepPreviousData,
  })
  return { ...result, rows: result.data?.rows || [], total: result.data?.total || 0, query, params }
}

export function ServerGrid({ rows, total, loading, urlState, defaultSort, columns, height = 'calc(100vh - 230px)', ...rest }) {
  const page = Number(urlState.get('page')) || 0
  const pageSize = Number(urlState.get('pageSize')) || PAGE_SIZES[1]
  const sortField = urlState.get('sort') || defaultSort.field
  const sortDir = urlState.get('dir') || defaultSort.dir
  return (
    <div style={{ height, width: '100%' }}>
      <DataGrid
        rows={rows}
        columns={columns.map((c) => ({ filterable: false, ...c }))}
        rowCount={total}
        loading={loading}
        density="compact"
        paginationMode="server"
        sortingMode="server"
        pageSizeOptions={PAGE_SIZES}
        paginationModel={{ page, pageSize }}
        onPaginationModelChange={(m) => urlState.set({ page: m.page || '', pageSize: m.pageSize === PAGE_SIZES[1] ? '' : m.pageSize }, { resetPage: false })}
        sortModel={[{ field: sortField, sort: sortDir }]}
        sortingOrder={['asc', 'desc']}
        onSortModelChange={(m) => urlState.set(m.length ? { sort: m[0].field, dir: m[0].sort } : { sort: '', dir: '' })}
        disableColumnFilter
        disableColumnMenu
        disableRowSelectionOnClick
        keepNonExistentRowsSelected
        sx={{ bgcolor: 'background.paper', '& .MuiDataGrid-row': { cursor: rest.onRowClick ? 'pointer' : 'default' } }}
        {...rest}
      />
    </div>
  )
}
