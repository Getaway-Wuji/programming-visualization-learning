#include <iostream>

int main() {
    int n; std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) { std::cin >> a[i]; }
    int action; int position; int value;
    std::cin >> action >> position >> value;
    int next[13]; int prev[13];
    for (int i = 0; i < 13; i = i + 1) { next[i] = -1; prev[i] = -1; }
    for (int i = 0; i < n - 1; i = i + 1) { next[i] = i + 1; prev[i + 1] = i; }
    int head = -1; if (n > 0) { head = 0; }
    int size = n;
    // 开始观察算法
    if (action == 1 && n < 12 && position >= 0 && position <= n) {
        a[n] = value;
        if (position == 0) {
            next[n] = head;
            if (head != -1) { prev[head] = n; }
            head = n;
        } else {
            int before = head;
            for (int i = 1; i < position; i = i + 1) { before = next[before]; }
            int after = next[before]; next[n] = after; prev[n] = before; next[before] = n;
            if (after != -1) { prev[after] = n; }
        }
        size = size + 1;
    }
    if (action == 2 && position >= 0 && position < size) {
        int current = head;
        for (int i = 0; i < position; i = i + 1) { current = next[current]; }
        int before = prev[current]; int after = next[current];
        if (before == -1) { head = after; } else { next[before] = after; }
        if (after != -1) { prev[after] = before; }
        next[current] = -1; prev[current] = -1; size = size - 1;
    }
    if (action == 3) {
        int current = head; int before = -1;
        while (current != -1) {
            int after = next[current];
            next[current] = before; prev[current] = after;
            before = current; current = after;
        }
        head = before;
    }
    int current = head;
    while (current != -1) { std::cout << a[current] << " "; current = next[current]; }
    std::cout << "\n";

    return 0;
}
