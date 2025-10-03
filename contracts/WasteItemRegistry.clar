(define-non-fungible-token waste-item uint)

(define-map waste-items 
  { item-id: uint } 
  { 
    owner: principal, 
    item-hash: (buff 32), 
    item-type: (string-ascii 50), 
    weight: uint, 
    hazardous: bool, 
    created-at: uint,
    description: (string-ascii 256),
    serial-number: (optional (string-ascii 100)),
    manufacturer: (optional principal),
    status: (string-ascii 20)
  }
)

(define-map item-by-hash 
  { item-hash: (buff 32) } 
  { item-id: uint }
)

(define-data-var item-counter uint u0)
(define-data-var contract-admin principal tx-sender)
(define-data-var registration-fee uint u100)

(define-constant err-unauthorized u100)
(define-constant err-duplicate-hash u101)
(define-constant err-item-not-found u102)
(define-constant err-invalid-hash u103)
(define-constant err-invalid-type u104)
(define-constant err-invalid-weight u105)
(define-constant err-invalid-description u106)
(define-constant err-invalid-serial u107)
(define-constant err-invalid-manufacturer u108)
(define-constant err-invalid-status u109)
(define-constant err-invalid-owner u110)
(define-constant err-transfer-failed u111)
(define-constant err-burn-failed u112)
(define-constant err-update-failed u113)
(define-constant err-fee-transfer-failed u114)
(define-constant err-invalid-fee u115)
(define-constant err-admin-only u116)
(define-constant err-status-change-invalid u117)
(define-constant err-already-registered u118)
(define-constant err-not-owner u119)
(define-constant err-contract-not-set u120)

(define-private (validate-hash (hash (buff 32)))
  (if (is-eq (len hash) u32)
    (ok true)
    (err err-invalid-hash)))

(define-private (validate-type (type (string-ascii 50)))
  (if (and (> (len type) u0) (<= (len type) u50))
    (ok true)
    (err err-invalid-type)))

(define-private (validate-weight (weight uint))
  (if (> weight u0)
    (ok true)
    (err err-invalid-weight)))

(define-private (validate-hazardous (hazardous bool))
  (ok true))

(define-private (validate-description (desc (string-ascii 256)))
  (if (<= (len desc) u256)
    (ok true)
    (err err-invalid-description)))

(define-private (validate-serial (serial (optional (string-ascii 100))))
  (match serial s
    (if (<= (len s) u100)
      (ok true)
      (err err-invalid-serial))
    (ok true)))

(define-private (validate-manufacturer (manu (optional principal)))
  (ok true))

(define-private (validate-status (status (string-ascii 20)))
  (if (or (is-eq status "registered") (is-eq status "collected") (is-eq status "transported") (is-eq status "processed") (is-eq status "disposed"))
    (ok true)
    (err err-invalid-status)))

(define-private (validate-owner (owner principal))
  (if (not (is-eq owner 'SP000000000000000000002Q6VF78))
    (ok true)
    (err err-invalid-owner)))

(define-public (set-registration-fee (new-fee uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err err-admin-only))
    (asserts! (>= new-fee u0) (err err-invalid-fee))
    (var-set registration-fee new-fee)
    (ok true)))

(define-public (set-contract-admin (new-admin principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err err-admin-only))
    (try! (validate-owner new-admin))
    (var-set contract-admin new-admin)
    (ok true)))

(define-public (register-item 
  (item-hash (buff 32)) 
  (item-type (string-ascii 50)) 
  (weight uint) 
  (hazardous bool)
  (description (string-ascii 256))
  (serial (optional (string-ascii 100)))
  (manufacturer (optional principal))
)
  (let 
    (
      (item-id (+ (var-get item-counter) u1))
      (caller tx-sender)
    )
    (try! (contract-call? .UserRegistry is-authorized caller))
    (try! (validate-hash item-hash))
    (try! (validate-type item-type))
    (try! (validate-weight weight))
    (try! (validate-hazardous hazardous))
    (try! (validate-description description))
    (try! (validate-serial serial))
    (try! (validate-manufacturer manufacturer))
    (asserts! (is-none (map-get? item-by-hash { item-hash: item-hash })) (err err-duplicate-hash))
    (try! (stx-transfer? (var-get registration-fee) caller (var-get contract-admin)))
    (try! (nft-mint? waste-item item-id caller))
    (map-insert waste-items 
      { item-id: item-id } 
      { 
        owner: caller, 
        item-hash: item-hash, 
        item-type: item-type, 
        weight: weight, 
        hazardous: hazardous, 
        created-at: block-height,
        description: description,
        serial-number: serial,
        manufacturer: manufacturer,
        status: "registered"
      }
    )
    (map-insert item-by-hash { item-hash: item-hash } { item-id: item-id })
    (var-set item-counter item-id)
    (print { event: "item-registered", id: item-id, hash: item-hash })
    (ok item-id)
  )
)

(define-read-only (get-item-details (item-id uint))
  (map-get? waste-items { item-id: item-id }))

(define-read-only (get-item-by-hash (hash (buff 32)))
  (match (map-get? item-by-hash { item-hash: hash })
    entry (get-item-details (get item-id entry))
    none))

(define-read-only (get-owner (item-id uint))
  (ok (nft-get-owner? waste-item item-id)))

(define-public (transfer-item (item-id uint) (new-owner principal))
  (let 
    (
      (current-owner (unwrap! (nft-get-owner? waste-item item-id) (err err-item-not-found)))
    )
    (asserts! (is-eq tx-sender current-owner) (err err-not-owner))
    (try! (contract-call? .UserRegistry is-authorized new-owner))
    (try! (validate-owner new-owner))
    (try! (nft-transfer? waste-item item-id tx-sender new-owner))
    (map-set waste-items 
      { item-id: item-id } 
      (merge 
        (unwrap! (map-get? waste-items { item-id: item-id }) (err err-item-not-found))
        { owner: new-owner }
      )
    )
    (print { event: "item-transferred", id: item-id, new-owner: new-owner })
    (ok true)
  )
)

(define-public (update-item-status (item-id uint) (new-status (string-ascii 20)))
  (let 
    (
      (item (unwrap! (map-get? waste-items { item-id: item-id }) (err err-item-not-found)))
      (current-owner (unwrap! (nft-get-owner? waste-item item-id) (err err-item-not-found)))
    )
    (asserts! (is-eq tx-sender current-owner) (err err-not-owner))
    (try! (validate-status new-status))
    (map-set waste-items 
      { item-id: item-id } 
      (merge item { status: new-status })
    )
    (print { event: "status-updated", id: item-id, status: new-status })
    (ok true)
  )
)

(define-public (burn-item (item-id uint))
  (let 
    (
      (current-owner (unwrap! (nft-get-owner? waste-item item-id) (err err-item-not-found)))
      (item (unwrap! (map-get? waste-items { item-id: item-id }) (err err-item-not-found)))
    )
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err err-admin-only))
    (try! (nft-burn? waste-item item-id current-owner))
    (map-delete waste-items { item-id: item-id })
    (map-delete item-by-hash { item-hash: (get item-hash item) })
    (print { event: "item-burned", id: item-id })
    (ok true)
  )
)

(define-read-only (get-item-count)
  (ok (var-get item-counter)))

(define-read-only (get-registration-fee)
  (ok (var-get registration-fee)))

(define-read-only (is-item-registered (hash (buff 32)))
  (ok (is-some (map-get? item-by-hash { item-hash: hash }))))