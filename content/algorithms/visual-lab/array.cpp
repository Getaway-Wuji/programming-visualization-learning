#include <iostream>

int main() {
    int n; std::cin >> n;
    int a[12] = {};
    for (int i = 0; i < n; i = i + 1) { std::cin >> a[i]; }
    int action; int position; int value;
    std::cin >> action >> position >> value;
    // 开始观察算法
    int size = n;
    if (action == 1 && size < 12 && position >= 0 && position <= size) {
        for (int i = size; i > position; i = i - 1) { a[i] = a[i - 1]; }
        a[position] = value; size = size + 1;
    }
    if (action == 2 && position >= 0 && position < size) {
        for (int i = position; i < size - 1; i = i + 1) { a[i] = a[i + 1]; }
        size = size - 1;
    }
    if (action == 3) {
        for (int i = 0; i < size / 2; i = i + 1) {
            // 交换开始
            int temp = a[i]; a[i] = a[size - 1 - i]; a[size - 1 - i] = temp;
            // 交换结束

        }
    }
    if (action == 4) {
        int found = -1;
        for (int i = 0; i < size; i = i + 1) { if (a[i] == value) { found = i; break; } }
        std::cout << found << "\n";
        return 0;
    }
    for (int i = 0; i < size; i = i + 1) { std::cout << a[i] << " "; }
    std::cout << "\n";

    return 0;
}
