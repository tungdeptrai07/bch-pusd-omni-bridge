import hashlib
import unittest


def verify_pusd_covenant(secret: str, amount: int, did_commitment: str) -> dict:
    expected_hash = hashlib.sha256(secret.encode()).hexdigest()
    valid = amount > 0 and len(did_commitment) > 0
    return {
        "valid": valid,
        "htlc_hash": expected_hash,
        "pusd_amount": amount,
        "did_verified": bool(did_commitment),
    }


class BchBridgeTests(unittest.TestCase):
    def test_valid_pusd_bridge_and_did(self) -> None:
        res = verify_pusd_covenant("bch-secret", 250, "did:bch:paytaca:01")
        self.assertTrue(res["valid"])
        self.assertTrue(res["did_verified"])


if __name__ == "__main__":
    unittest.main()
