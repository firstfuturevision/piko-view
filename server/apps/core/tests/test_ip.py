"""요청한 사람 IP·비율 제한 키."""
from django.test import RequestFactory, SimpleTestCase
from rest_framework.throttling import BaseThrottle

from ..ip import client_ip

rf = RequestFactory()


def req(remote='127.0.0.1', **headers):
    return rf.get('/', REMOTE_ADDR=remote, **headers)


class ClientIPTests(SimpleTestCase):
    def test_cf_header_behind_local_proxy(self):
        self.assertEqual(client_ip(req(HTTP_CF_CONNECTING_IP='203.0.113.5')), '203.0.113.5')

    def test_headers_ignored_when_remote_is_public(self):
        # 밖에서 바로 붙은 요청은 헤더를 믿지 않는다
        r = req('8.8.4.4', HTTP_CF_CONNECTING_IP='1.2.3.4', HTTP_X_FORWARDED_FOR='1.2.3.4')
        self.assertEqual(client_ip(r), '8.8.4.4')

    def test_rightmost_untrusted_xff_hop(self):
        # 맨 왼쪽(위조 가능)이 아니라 오른쪽에서 처음 만나는 믿지 않는 주소
        r = req(HTTP_X_FORWARDED_FOR='6.6.6.6, 198.51.100.9, 10.0.0.1, 127.0.0.1')
        self.assertEqual(client_ip(r), '198.51.100.9')

    def test_spoofed_left_hop_does_not_change_ident(self):
        a = client_ip(req(HTTP_X_FORWARDED_FOR='1.1.1.1, 198.51.100.9'))
        b = client_ip(req(HTTP_X_FORWARDED_FOR='2.2.2.2, 198.51.100.9'))
        self.assertEqual(a, b)

    def test_garbage_and_missing(self):
        self.assertEqual(client_ip(req(HTTP_X_FORWARDED_FOR='nope')), '127.0.0.1')
        self.assertEqual(client_ip(req(HTTP_CF_CONNECTING_IP='x', HTTP_X_FORWARDED_FOR='')), '127.0.0.1')
        self.assertEqual(client_ip(req()), '127.0.0.1')

    def test_drf_throttles_use_client_ip(self):
        # BaseThrottle.get_ident 를 바꿔 끼웠으므로 DRF 기본 클래스도 같은 키
        t = BaseThrottle()
        self.assertEqual(t.get_ident(req(HTTP_X_FORWARDED_FOR='9.9.9.9, 198.51.100.9')), '198.51.100.9')
