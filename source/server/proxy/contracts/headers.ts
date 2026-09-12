/**
 * 报文头映射。这是全仓库唯一的头类型：响应的采集、上游请求头的构造、
 * 修改器的载荷都用它，避免各处重复定义。
 */
export type HeaderMap = Record<string, string | string[] | undefined>
