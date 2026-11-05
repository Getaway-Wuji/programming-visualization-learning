#include <iostream>

int main() {
    int count; std::cin >> count;
    int link[72] = {}; int terminal[24] = {}; int size = 1;
    // 开始观察算法
    for (int word = 0; word < count; word = word + 1) {
        int length; std::cin >> length; int current = 0;
        for (int i = 0; i < length; i = i + 1) {
            int letter; std::cin >> letter;
            int slot = current * 3 + letter;
            if (link[slot] == 0) { link[slot] = size; size = size + 1; }
            current = link[slot];
        }
        terminal[current] = 1;
    }
    int length; std::cin >> length; int current = 0; int found = 1;
    for (int i = 0; i < length; i = i + 1) {
        int letter; std::cin >> letter;
        if (found == 1) {
            int child = link[current * 3 + letter];
            if (child == 0) { found = 0; } else { current = child; }
        }
    }
    std::cout << found << " ";
    if (found == 1) { std::cout << terminal[current]; } else { std::cout << 0; }
    std::cout << "\n";
    return 0;
}
